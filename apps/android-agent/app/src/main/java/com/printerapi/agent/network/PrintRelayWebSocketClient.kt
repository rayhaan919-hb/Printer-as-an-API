package com.printerapi.agent.network

import com.printerapi.agent.json.MiniJson
import com.printerapi.agent.json.intOrNull
import com.printerapi.agent.json.listOrNull
import com.printerapi.agent.json.stringOrNull
import com.printerapi.agent.queue.EnqueueResult
import com.printerapi.agent.queue.OfflineJobQueueRepository
import com.printerapi.agent.queue.PrintJobEntity
import com.printerapi.agent.rasterizer.EscPosRasterizer
import com.printerapi.agent.rasterizer.PaperWidth
import com.printerapi.agent.rasterizer.RasterizedOutput
import com.printerapi.agent.rasterizer.ReceiptLineItem
import com.printerapi.agent.rasterizer.ReceiptPayload
import com.printerapi.agent.transport.EscPosTransport
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class RelayStatusSnapshot(
    val connected: Boolean,
    val wsUrl: String,
    val lastError: String? = null,
    val lastAckedJobId: String? = null,
    val lastRasterizedBytes: Int = 0
)

/**
 * WebSocket relay client connecting to `/ws?printer_id=...`.
 *
 * Flow:
 * 1. Sends `REGISTER` frame on WebSocket open and replays any pending offline jobs.
 * 2. Parses `DISPATCHED` frames (`JSON_RECEIPT`, `RAW_TEXT`, `HTML`) and deduplicates in [OfflineJobQueueRepository].
 * 3. Transitions `QUEUED -> PRINTING`, rasterizes 1-bit ESC/POS `GS v 0` bytes, writes + flushes via [EscPosTransport].
 * 4. Marks `ACK` in offline queue and emits `{ "type": "ACK", "status": "ACK", "job_id": "...", ... }` over WebSocket.
 * 5. On transport/raster failure, marks `FAILED` so the job is replayed automatically upon reconnect.
 */
class PrintRelayWebSocketClient(
    private val queueRepository: OfflineJobQueueRepository,
    private val transport: EscPosTransport,
    private val connector: RelaySocketConnector = Rfc6455WebSocketConnector(),
    private val paperWidthProvider: () -> PaperWidth = { PaperWidth.MM_58 },
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val onRasterized: (PrintJobEntity, RasterizedOutput) -> Unit = { _, _ -> },
    private val onStatusChanged: (RelayStatusSnapshot) -> Unit = {}
) {

    companion object {
        fun buildWebSocketUrl(baseUrl: String, printerId: String): String {
            val trimmed = baseUrl.trim().trimEnd('/')
            val wsBase = when {
                trimmed.startsWith("https://", ignoreCase = true) -> "wss://" + trimmed.removePrefix("https://")
                trimmed.startsWith("http://", ignoreCase = true) -> "ws://" + trimmed.removePrefix("http://")
                trimmed.startsWith("wss://", ignoreCase = true) || trimmed.startsWith("ws://", ignoreCase = true) -> trimmed
                else -> "ws://$trimmed"
            }
            val endpoint = if (wsBase.endsWith("/ws")) wsBase else "$wsBase/ws"
            val encodedPrinterId = URLEncoder.encode(printerId, StandardCharsets.UTF_8.name())
            val sep = if (endpoint.contains('?')) '&' else '?'
            return "$endpoint${sep}printer_id=$encodedPrinterId"
        }

        fun formatIsoUtc(epochMillis: Long): String {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            return sdf.format(Date(epochMillis))
        }
    }

    private val dispatchLock = Any()

    @Volatile
    private var sender: WebSocketFrameSender? = null

    @Volatile
    private var currentPrinterId: String = ""

    @Volatile
    private var currentWsUrl: String = ""

    @Volatile
    private var lastAckedJobId: String? = null

    @Volatile
    private var lastRasterBytes: Int = 0

    val isConnected: Boolean
        get() = sender?.isOpen == true

    fun connect(baseOrWsUrl: String, printerId: String) {
        disconnect()
        currentPrinterId = printerId
        val wsUrl = buildWebSocketUrl(baseOrWsUrl, printerId)
        currentWsUrl = wsUrl

        sender = connector.connect(
            wsUrl = wsUrl,
            onOpen = { activeSender ->
                sender = activeSender
                val registerFrame = MiniJson.encodeObject(
                    mapOf(
                        "type" to "REGISTER",
                        "printer_id" to printerId
                    )
                )
                activeSender.sendText(registerFrame)
                notifyStatus(connected = true, error = null)
                flushPendingQueue()
            },
            onTextMessage = { rawJson ->
                handleIncomingMessage(rawJson)
            },
            onClosed = { reason ->
                notifyStatus(connected = false, error = reason)
            },
            onError = { err ->
                notifyStatus(connected = false, error = err.message ?: err::class.java.simpleName)
            }
        )
    }

    fun disconnect() {
        val active = sender
        sender = null
        active?.close()
        notifyStatus(connected = false, error = null)
    }

    /**
     * Parses a raw WebSocket text frame. Supports `DISPATCHED` / `PRINT_JOB` messages matching
     * `tests/mocks/mock_agent.ts` and `api-contract.yaml`.
     */
    fun handleIncomingMessage(rawJson: String): Boolean {
        val frame = runCatching { MiniJson.parseObject(rawJson) }.getOrNull() ?: return false
        val msgType = frame.stringOrNull("type")?.uppercase(Locale.US)
        val msgStatus = frame.stringOrNull("status")?.uppercase(Locale.US)
        val isDispatch = msgType == "DISPATCHED" || msgType == "PRINT_JOB" || msgStatus == "DISPATCHED"
        if (!isDispatch) {
            return false
        }

        val jobId = frame.stringOrNull("job_id", "id") ?: return false
        val printerId = frame.stringOrNull("printer_id") ?: currentPrinterId
        val payloadType = frame.stringOrNull("payload_type")?.uppercase(Locale.US) ?: "JSON_RECEIPT"
        val rawPayload = frame["payload"]
        val payloadJson = when (rawPayload) {
            is Map<*, *> -> MiniJson.encodeValue(rawPayload)
            is String -> rawPayload
            null -> "{}"
            else -> MiniJson.encodeValue(rawPayload)
        }

        when (queueRepository.enqueueIfAbsent(jobId, printerId, payloadType, payloadJson)) {
            EnqueueResult.ALREADY_ACKED -> {
                val existing = queueRepository.getJob(jobId)
                sendAckFrame(jobId, printerId, existing?.ackedAt ?: clock())
                return true
            }
            EnqueueResult.ALREADY_PENDING -> {
                return true
            }
            EnqueueResult.ENQUEUED -> {
                val entity = queueRepository.getJob(jobId) ?: return false
                return processJob(entity)
            }
        }
    }

    /**
     * Replays all pending (`QUEUED`, interrupted `PRINTING`, or retryable `FAILED`) jobs in FIFO order.
     */
    fun flushPendingQueue(maxRetries: Int = 3): Int {
        var ackedCount = 0
        val pending = queueRepository.pendingJobsForReplay(maxRetries)
        for (job in pending) {
            if (processJob(job)) {
                ackedCount++
            }
        }
        return ackedCount
    }

    private fun processJob(job: PrintJobEntity): Boolean = synchronized(dispatchLock) {
        val printing = queueRepository.markPrinting(job.jobId) ?: return false
        if (printing.status == com.printerapi.agent.queue.JobStatus.ACK) {
            return true
        }

        return try {
            val paperWidth = paperWidthProvider()
            val rasterized = rasterizeJobPayload(
                payloadType = printing.payloadType,
                payloadJson = printing.payloadJson,
                paperWidth = paperWidth
            )
            if (!transport.isConnected) {
                transport.connect()
            }
            transport.write(rasterized.escPosBytes)
            transport.flush()

            val ackTimestamp = clock()
            queueRepository.markAck(printing.jobId, ackTimestamp)
            lastAckedJobId = printing.jobId
            lastRasterBytes = rasterized.escPosBytes.size
            onRasterized(printing, rasterized)
            sendAckFrame(printing.jobId, printing.printerId, ackTimestamp)
            notifyStatus(connected = isConnected, error = null)
            true
        } catch (err: Throwable) {
            val errorMsg = err.message ?: err::class.java.simpleName
            queueRepository.markFailed(printing.jobId, errorMsg)
            notifyStatus(connected = isConnected, error = errorMsg)
            false
        }
    }

    private fun sendAckFrame(jobId: String, printerId: String, ackedAtMillis: Long) {
        val activeSender = sender ?: return
        if (!activeSender.isOpen) return
        val ackPayload = MiniJson.encodeObject(
            mapOf(
                "type" to "ACK",
                "status" to "ACK",
                "job_id" to jobId,
                "printer_id" to printerId,
                "acked_at" to formatIsoUtc(ackedAtMillis)
            )
        )
        activeSender.sendText(ackPayload)
    }

    private fun notifyStatus(connected: Boolean, error: String?) {
        onStatusChanged(
            RelayStatusSnapshot(
                connected = connected,
                wsUrl = currentWsUrl,
                lastError = error,
                lastAckedJobId = lastAckedJobId,
                lastRasterizedBytes = lastRasterBytes
            )
        )
    }

    fun rasterizeJobPayload(
        payloadType: String,
        payloadJson: String,
        paperWidth: PaperWidth
    ): RasterizedOutput {
        return when (payloadType.uppercase(Locale.US)) {
            "RAW_TEXT" -> {
                val parsed = runCatching { MiniJson.parseObject(payloadJson) }.getOrNull()
                val rawText = parsed?.stringOrNull("text", "content", "body", "message")
                    ?: payloadJson
                EscPosRasterizer.rasterizeText(rawText, paperWidth)
            }
            "HTML" -> {
                val parsed = runCatching { MiniJson.parseObject(payloadJson) }.getOrNull()
                val html = parsed?.stringOrNull("html", "content", "body")
                    ?: payloadJson
                EscPosRasterizer.rasterizeHtml(html, paperWidth)
            }
            else -> {
                val parsed = runCatching { MiniJson.parseObject(payloadJson) }.getOrNull()
                if (parsed == null) {
                    EscPosRasterizer.rasterizeText(payloadJson, paperWidth)
                } else {
                    val receipt = mapJsonToReceipt(parsed)
                    EscPosRasterizer.rasterizeReceipt(receipt, paperWidth)
                }
            }
        }
    }

    private fun mapJsonToReceipt(json: Map<String, Any?>): ReceiptPayload {
        val title = json.stringOrNull("title", "header", "merchant", "store_name") ?: ""
        val subtitle = json.stringOrNull("subtitle", "order_id", "orderId", "date") ?: ""
        val total = json.stringOrNull("total_formatted", "totalFormatted", "total", "grand_total") ?: ""
        val footer = json.stringOrNull("footer", "thank_you", "note", "message") ?: ""

        val rawItems = json.listOrNull("items", "lines", "line_items").orEmpty()
        val parsedItems = rawItems.mapNotNull { entry ->
            when (entry) {
                is Map<*, *> -> {
                    @Suppress("UNCHECKED_CAST")
                    val map = entry as Map<String, Any?>
                    val name = map.stringOrNull("name", "title", "item", "description") ?: return@mapNotNull null
                    val qty = map.intOrNull("qty", "quantity") ?: 1
                    val price = map.stringOrNull("price_formatted", "priceFormatted", "price", "amount") ?: ""
                    ReceiptLineItem(name = name, qty = qty, priceFormatted = price)
                }
                is String -> ReceiptLineItem(name = entry, qty = 1, priceFormatted = "")
                else -> null
            }
        }

        if (title.isBlank() && subtitle.isBlank() && parsedItems.isEmpty() && total.isBlank() && footer.isBlank()) {
            val singleText = json.stringOrNull("text", "content")
            if (singleText != null) {
                return ReceiptPayload(title = singleText)
            }
            val fallbackItems = json.entries.mapNotNull { (k, v) ->
                if (v == null) null else ReceiptLineItem(name = "$k: $v", qty = 1, priceFormatted = "")
            }
            return ReceiptPayload(title = "RECEIPT", items = fallbackItems)
        }

        return ReceiptPayload(
            title = title,
            subtitle = subtitle,
            items = parsedItems,
            totalFormatted = total,
            footer = footer
        )
    }
}
