package com.printerapi.agent.service

import android.content.Context
import com.printerapi.agent.json.MiniJson
import com.printerapi.agent.network.PairPrinterClient
import com.printerapi.agent.network.PrintRelayWebSocketClient
import com.printerapi.agent.queue.InMemoryPrintJobDao
import com.printerapi.agent.queue.OfflineDatabase
import com.printerapi.agent.queue.OfflineJobQueueRepository
import com.printerapi.agent.queue.PrintJobEntity
import com.printerapi.agent.queue.SqlitePrintJobDao
import com.printerapi.agent.rasterizer.EscPosRasterizer
import com.printerapi.agent.rasterizer.PaperWidth
import com.printerapi.agent.rasterizer.RasterizedOutput
import com.printerapi.agent.rasterizer.ReceiptLineItem
import com.printerapi.agent.rasterizer.ReceiptPayload
import com.printerapi.agent.transport.BluetoothTransport
import com.printerapi.agent.transport.EscPosTransport
import com.printerapi.agent.transport.InMemoryByteSinkTransport
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

enum class TransportMode {
    IN_MEMORY_MOCK,
    BLUETOOTH_SPP
}

data class AgentUiState(
    val apiBaseUrl: String = "http://10.0.2.2:4000",
    val pairingCode: String = "482910",
    val printerName: String = "Android Thermal #01",
    val pairedPrinterId: String = "550e8400-e29b-41d4-a716-446655440001",
    val isPaired: Boolean = false,
    val paperWidth: PaperWidth = PaperWidth.MM_58,
    val transportMode: TransportMode = TransportMode.IN_MEMORY_MOCK,
    val bluetoothMac: String = "00:11:22:33:44:55",
    val isServiceRunning: Boolean = false,
    val isWsConnected: Boolean = false,
    val isPairingInProgress: Boolean = false,
    val isLoadingQueue: Boolean = false,
    val errorBanner: String? = null,
    val statusNote: String? = null,
    val lastRasterHeaderHex: String? = null,
    val lastRasterSummary: String? = null,
    val jobs: List<PrintJobEntity> = emptyList()
)

/**
 * Shared singleton runtime coordinating SQLite offline queue persistence, ESC/POS transport,
 * pairing API calls, WebSocket relay sessions, and UI state updates across [PrintAgentForegroundService]
 * and [com.printerapi.agent.MainActivity].
 */
object AgentRuntimeController {

    private val lock = Any()
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val stateListeners = CopyOnWriteArrayList<(AgentUiState) -> Unit>()
    private val pairClient = PairPrinterClient()

    @Volatile
    private var initialized = false

    @Volatile
    private var state = AgentUiState()

    private var queueRepository: OfflineJobQueueRepository =
        OfflineJobQueueRepository(InMemoryPrintJobDao())

    private var mockTransport = InMemoryByteSinkTransport(autoConnect = true)
    private var bluetoothTransport: BluetoothTransport? = null
    private var relayClient: PrintRelayWebSocketClient? = null

    fun ensureInitialized(context: Context) {
        synchronized(lock) {
            if (initialized) return
            val dbHelper = OfflineDatabase(context.applicationContext)
            queueRepository = OfflineJobQueueRepository(SqlitePrintJobDao(dbHelper))
            queueRepository.addListener { jobs ->
                updateState { copy(jobs = jobs, isLoadingQueue = false) }
            }
            rebuildRelayClientLocked()
            val initialJobs = queueRepository.allJobs()
            state = state.copy(jobs = initialJobs, isLoadingQueue = false)
            initialized = true
        }
        notifyStateListeners()
    }

    fun currentState(): AgentUiState = state

    fun addStateListener(listener: (AgentUiState) -> Unit) {
        stateListeners.add(listener)
        listener(state)
    }

    fun removeStateListener(listener: (AgentUiState) -> Unit) {
        stateListeners.remove(listener)
    }

    fun updateApiBaseUrl(url: String) {
        updateState { copy(apiBaseUrl = url, errorBanner = null) }
    }

    fun updatePairingCode(code: String) {
        val digitsOnly = code.filter { it.isDigit() }.take(6)
        updateState { copy(pairingCode = digitsOnly, errorBanner = null) }
    }

    fun updatePrinterName(name: String) {
        updateState { copy(printerName = name, errorBanner = null) }
    }

    fun updatePaperWidth(width: PaperWidth) {
        updateState { copy(paperWidth = width) }
    }

    fun updateTransportMode(mode: TransportMode) {
        synchronized(lock) {
            state = state.copy(transportMode = mode, errorBanner = null)
            rebuildRelayClientLocked()
        }
        notifyStateListeners()
    }

    fun updateBluetoothMac(mac: String) {
        synchronized(lock) {
            bluetoothTransport?.disconnect()
            bluetoothTransport = null
            state = state.copy(bluetoothMac = mac, errorBanner = null)
            if (state.transportMode == TransportMode.BLUETOOTH_SPP) {
                rebuildRelayClientLocked()
            }
        }
        notifyStateListeners()
    }

    fun dismissError() {
        updateState { copy(errorBanner = null) }
    }

    fun setServiceRunning(running: Boolean) {
        updateState { copy(isServiceRunning = running) }
    }

    fun reportServiceError(message: String) {
        updateState { copy(isServiceRunning = false, errorBanner = message) }
    }

    fun pairAgent() {
        val snapshot = state
        updateState { copy(isPairingInProgress = true, errorBanner = null, statusNote = null) }
        ioExecutor.execute {
            val result = pairClient.pairPrinter(
                apiBaseUrl = snapshot.apiBaseUrl,
                pairingCode = snapshot.pairingCode,
                printerName = snapshot.printerName,
                paperWidth = snapshot.paperWidth
            )
            result.fold(
                onSuccess = { paired ->
                    updateState {
                        copy(
                            isPairingInProgress = false,
                            isPaired = true,
                            pairedPrinterId = paired.printerId,
                            printerName = paired.name,
                            paperWidth = paired.paperWidth,
                            errorBanner = null,
                            statusNote = "Paired printer ${paired.printerId.take(12)} (${paired.paperWidth.mm}mm)"
                        )
                    }
                    if (state.isServiceRunning) {
                        connectRelay()
                    }
                },
                onFailure = { err ->
                    updateState {
                        copy(
                            isPairingInProgress = false,
                            errorBanner = err.message ?: "Unable to pair printer with relay API"
                        )
                    }
                }
            )
        }
    }

    fun connectRelay() {
        val snapshot = state
        val client = synchronized(lock) {
            if (relayClient == null) rebuildRelayClientLocked()
            relayClient!!
        }
        ioExecutor.execute {
            try {
                client.connect(snapshot.apiBaseUrl, snapshot.pairedPrinterId)
            } catch (err: Throwable) {
                updateState {
                    copy(
                        isWsConnected = false,
                        errorBanner = err.message ?: "WebSocket connection failed"
                    )
                }
            }
        }
    }

    fun disconnectRelay() {
        synchronized(lock) {
            relayClient?.disconnect()
        }
        updateState { copy(isWsConnected = false) }
    }

    fun flushPendingQueue() {
        val client = synchronized(lock) {
            if (relayClient == null) rebuildRelayClientLocked()
            relayClient!!
        }
        ioExecutor.execute {
            val acked = client.flushPendingQueue()
            updateState {
                copy(
                    jobs = queueRepository.allJobs(),
                    statusNote = if (acked > 0) "Replayed $acked pending job(s)" else statusNote
                )
            }
        }
    }

    fun triggerTestPrint() {
        val snapshot = state
        ioExecutor.execute {
            val jobId = "test_${UUID.randomUUID().toString().take(8)}"
            val receipt = ReceiptPayload(
                title = "PRINTER-API TEST",
                subtitle = "Bilingual ${snapshot.paperWidth.mm}mm Roll",
                items = listOf(
                    ReceiptLineItem("Thermal Raster GS v 0", 1, "$0.00"),
                    ReceiptLineItem("رسید - شکریہ", 1, "RTL OK")
                ),
                totalFormatted = "TOTAL: OK",
                footer = "فاتورة ضريبية"
            )
            val payloadJson = MiniJson.encodeObject(
                mapOf(
                    "title" to receipt.title,
                    "subtitle" to receipt.subtitle,
                    "items" to receipt.items.map {
                        mapOf("name" to it.name, "qty" to it.qty, "price_formatted" to it.priceFormatted)
                    },
                    "total_formatted" to receipt.totalFormatted,
                    "footer" to receipt.footer
                )
            )
            queueRepository.enqueueIfAbsent(
                jobId = jobId,
                printerId = snapshot.pairedPrinterId,
                payloadType = "JSON_RECEIPT",
                payloadJson = payloadJson
            )
            queueRepository.markPrinting(jobId)
            try {
                val transport = activeTransportLocked()
                if (!transport.isConnected) {
                    transport.connect()
                }
                val output = EscPosRasterizer.rasterizeReceipt(receipt, snapshot.paperWidth)
                transport.write(output.escPosBytes)
                transport.flush()
                queueRepository.markAck(jobId)
                recordRasterPreview(jobId, output)
                updateState {
                    copy(
                        errorBanner = null,
                        statusNote = "Test print ACK (${output.escPosBytes.size} bytes)",
                        jobs = queueRepository.allJobs()
                    )
                }
            } catch (err: Throwable) {
                val msg = err.message ?: "Printer transport write failed"
                queueRepository.markFailed(jobId, msg)
                updateState {
                    copy(
                        errorBanner = msg,
                        jobs = queueRepository.allJobs()
                    )
                }
            }
        }
    }

    fun clearAckedJobs() {
        ioExecutor.execute {
            queueRepository.clearAcked()
            updateState { copy(jobs = queueRepository.allJobs()) }
        }
    }

    private fun activeTransportLocked(): EscPosTransport {
        return when (state.transportMode) {
            TransportMode.IN_MEMORY_MOCK -> mockTransport
            TransportMode.BLUETOOTH_SPP -> {
                val existing = bluetoothTransport
                if (existing != null) existing else BluetoothTransport(state.bluetoothMac).also {
                    bluetoothTransport = it
                }
            }
        }
    }

    private fun rebuildRelayClientLocked() {
        relayClient?.disconnect()
        val transport = activeTransportLocked()
        relayClient = PrintRelayWebSocketClient(
            queueRepository = queueRepository,
            transport = transport,
            paperWidthProvider = { state.paperWidth },
            onRasterized = { job, output ->
                recordRasterPreview(job.jobId, output)
            },
            onStatusChanged = { wsStatus ->
                updateState {
                    copy(
                        isWsConnected = wsStatus.connected,
                        errorBanner = wsStatus.lastError ?: errorBanner,
                        jobs = queueRepository.allJobs()
                    )
                }
            }
        )
    }

    private fun recordRasterPreview(jobId: String, output: RasterizedOutput) {
        val headerSlice = output.escPosBytes.take(10).joinToString(" ") { byte ->
            "%02X".format(byte.toInt() and 0xFF)
        }
        val summary = "${jobId.take(12)} • ${output.widthPx}x${output.heightPx}px • ${output.escPosBytes.size}B" +
            if (output.containsRtl) " • RTL" else ""
        updateState {
            copy(
                lastRasterHeaderHex = headerSlice,
                lastRasterSummary = summary
            )
        }
    }

    private inline fun updateState(transform: AgentUiState.() -> AgentUiState) {
        synchronized(lock) {
            state = state.transform()
        }
        notifyStateListeners()
    }

    private fun notifyStateListeners() {
        val snapshot = state
        stateListeners.forEach { it(snapshot) }
    }
}
