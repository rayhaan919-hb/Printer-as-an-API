package com.printerapi.agent

import com.printerapi.agent.json.MiniJson
import com.printerapi.agent.json.stringOrNull
import com.printerapi.agent.network.HttpPostExecutor
import com.printerapi.agent.network.HttpPostResponse
import com.printerapi.agent.network.PairPrinterClient
import com.printerapi.agent.network.PrintRelayWebSocketClient
import com.printerapi.agent.network.RelaySocketConnector
import com.printerapi.agent.network.WebSocketFrameSender
import com.printerapi.agent.queue.EnqueueResult
import com.printerapi.agent.queue.InMemoryPrintJobDao
import com.printerapi.agent.queue.JobStatus
import com.printerapi.agent.queue.OfflineJobQueueRepository
import com.printerapi.agent.rasterizer.EscPosRasterizer
import com.printerapi.agent.rasterizer.LineAlignment
import com.printerapi.agent.rasterizer.PaperWidth
import com.printerapi.agent.rasterizer.RasterLine
import com.printerapi.agent.rasterizer.RasterizedOutput
import com.printerapi.agent.rasterizer.ReceiptLineItem
import com.printerapi.agent.rasterizer.ReceiptPayload
import com.printerapi.agent.transport.InMemoryByteSinkTransport
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class EscPosRasterizerAndAgentTest {

    @Test
    fun gsV0HeaderAndPayloadSizesMatch58mmAnd80mmSpecs() {
        val out58 = EscPosRasterizer.rasterizeText("ORDER #101", PaperWidth.MM_58)
        assertEquals(384, out58.widthPx)
        assertEquals(48, out58.widthBytes)
        assertEquals(24, out58.heightPx)
        assertEquals(48 * 24, out58.rasterData.size)

        // ESC @ (0x1B, 0x40)
        assertEquals(0x1B.toByte(), out58.escPosBytes[0])
        assertEquals(0x40.toByte(), out58.escPosBytes[1])

        // GS v 0 m xL xH yL yH (1D 76 30 00 30 00 18 00)
        assertEquals(0x1D.toByte(), out58.escPosBytes[2])
        assertEquals(0x76.toByte(), out58.escPosBytes[3])
        assertEquals(0x30.toByte(), out58.escPosBytes[4])
        assertEquals(0x00.toByte(), out58.escPosBytes[5])
        assertEquals(48.toByte(), out58.escPosBytes[6]) // xL = 48
        assertEquals(0.toByte(), out58.escPosBytes[7])  // xH = 0
        assertEquals(24.toByte(), out58.escPosBytes[8]) // yL = 24
        assertEquals(0.toByte(), out58.escPosBytes[9])  // yH = 0

        // Total size: 2 (ESC @) + 8 (GS v 0 header) + rasterData + 4 (GS V 66 0)
        assertEquals(2 + 8 + out58.rasterData.size + 4, out58.escPosBytes.size)
        val cutOffset58 = out58.escPosBytes.size - 4
        assertArrayEquals(
            byteArrayOf(0x1D, 0x56, 0x42, 0x00),
            out58.escPosBytes.copyOfRange(cutOffset58, out58.escPosBytes.size)
        )

        // 80mm thermal paper with 12 lines -> 288px height to verify 16-bit yL/yH encoding
        val lines80 = (1..12).map { RasterLine("ITEM #$it", LineAlignment.LEFT) }
        val out80 = EscPosRasterizer.rasterizeLines(lines80, PaperWidth.MM_80)
        assertEquals(576, out80.widthPx)
        assertEquals(72, out80.widthBytes)
        assertEquals(288, out80.heightPx)
        assertEquals(72 * 288, out80.rasterData.size)

        assertEquals(0x1D.toByte(), out80.escPosBytes[2])
        assertEquals(0x76.toByte(), out80.escPosBytes[3])
        assertEquals(0x30.toByte(), out80.escPosBytes[4])
        assertEquals(0x00.toByte(), out80.escPosBytes[5])
        assertEquals(72.toByte(), out80.escPosBytes[6]) // xL = 72
        assertEquals(0.toByte(), out80.escPosBytes[7])  // xH = 0
        assertEquals(32.toByte(), out80.escPosBytes[8]) // yL = 288 & 0xFF = 32
        assertEquals(1.toByte(), out80.escPosBytes[9])  // yH = 288 >> 8 = 1
    }

    @Test
    fun rtlUrduAndArabicDetectBidiAndPlacePixelsInRightHalf() {
        val urdu = "رسید - شکریہ"
        val arabic = "فاتورة ضريبية"
        val english = "RECEIPT #101"

        assertTrue(EscPosRasterizer.isRtlText(urdu))
        assertTrue(EscPosRasterizer.isRtlText(arabic))
        assertFalse(EscPosRasterizer.isRtlText(english))

        assertEquals(LineAlignment.RIGHT, EscPosRasterizer.resolveAlignment(RasterLine(urdu)))
        assertEquals(LineAlignment.RIGHT, EscPosRasterizer.resolveAlignment(RasterLine(arabic)))
        assertEquals(LineAlignment.LEFT, EscPosRasterizer.resolveAlignment(RasterLine(english)))

        // Mixed RTL + LTR digits keeps "42" in LTR order inside visual output
        val visualMixed = EscPosRasterizer.shapeVisualOrder("رسید 42 شکریہ")
        assertTrue("Expected embedded digits '42' preserved in visual Bidi order", visualMixed.contains("42"))

        // 58mm Urdu RTL rasterization places black pixels strictly in right half (x >= 192)
        val urduOut58 = EscPosRasterizer.rasterizeText(urdu, PaperWidth.MM_58)
        assertTrue(urduOut58.containsRtl)
        assertEquals(0, countBlackPixelsInHorizontalHalf(urduOut58, leftHalf = true))
        assertTrue(countBlackPixelsInHorizontalHalf(urduOut58, leftHalf = false) > 0)

        // 80mm Arabic RTL rasterization places black pixels strictly in right half (x >= 288)
        val arabicOut80 = EscPosRasterizer.rasterizeText(arabic, PaperWidth.MM_80)
        assertTrue(arabicOut80.containsRtl)
        assertEquals(0, countBlackPixelsInHorizontalHalf(arabicOut80, leftHalf = true))
        assertTrue(countBlackPixelsInHorizontalHalf(arabicOut80, leftHalf = false) > 0)

        // Contrast with LTR English placing black pixels strictly in left half
        val englishOut58 = EscPosRasterizer.rasterizeText(english, PaperWidth.MM_58)
        assertFalse(englishOut58.containsRtl)
        assertTrue(countBlackPixelsInHorizontalHalf(englishOut58, leftHalf = true) > 0)
        assertEquals(0, countBlackPixelsInHorizontalHalf(englishOut58, leftHalf = false))
    }

    @Test
    fun inMemoryByteSinkTransportRecordsEscPosBytesAndEnforcesConnection() {
        val transport = InMemoryByteSinkTransport(autoConnect = true)
        val output = EscPosRasterizer.rasterizeReceipt(
            ReceiptPayload(
                title = "CAFE LINEAR",
                items = listOf(ReceiptLineItem("Espresso", 2, "$7.00")),
                totalFormatted = "TOTAL $7.00",
                footer = "رسید - شکریہ"
            ),
            PaperWidth.MM_58
        )

        transport.write(output.escPosBytes)
        transport.flush()

        assertEquals(1, transport.writtenChunks().size)
        assertEquals(1, transport.flushCount)
        assertArrayEquals(output.escPosBytes, transport.toByteArray())

        transport.disconnect()
        assertFalse(transport.isConnected)
        var threwIo = false
        try {
            transport.write(byteArrayOf(0x1B, 0x40))
        } catch (_: IOException) {
            threwIo = true
        }
        assertTrue("Expected IOException when writing to disconnected transport", threwIo)
    }

    @Test
    fun offlineJobQueueDeduplicatesAndTransitionsLifecycleStates() {
        var now = 1_700_000_000_000L
        val dao = InMemoryPrintJobDao()
        val repo = OfflineJobQueueRepository(dao = dao, clock = { now })

        assertEquals(
            EnqueueResult.ENQUEUED,
            repo.enqueueIfAbsent("job-1", "printer-1", "RAW_TEXT", "{\"text\":\"Hello\"}")
        )
        assertEquals(
            EnqueueResult.ALREADY_PENDING,
            repo.enqueueIfAbsent("job-1", "printer-1", "RAW_TEXT", "{\"text\":\"Hello\"}")
        )
        assertEquals(JobStatus.QUEUED, repo.getJob("job-1")?.status)

        val printing = repo.markPrinting("job-1")
        assertEquals(JobStatus.PRINTING, printing?.status)

        val failed = repo.markFailed("job-1", "Bluetooth socket timeout")
        assertEquals(JobStatus.FAILED, failed?.status)
        assertEquals(1, failed?.retryCount)
        assertEquals(1, repo.pendingJobsForReplay().size)

        now += 500
        repo.markPrinting("job-1")
        val acked = repo.markAck("job-1")
        assertEquals(JobStatus.ACK, acked?.status)
        assertEquals(now, acked?.ackedAt)
        assertTrue(repo.pendingJobsForReplay().isEmpty())

        assertEquals(
            EnqueueResult.ALREADY_ACKED,
            repo.enqueueIfAbsent("job-1", "printer-1", "RAW_TEXT", "{\"text\":\"Hello\"}")
        )
    }

    @Test
    fun webSocketRelayClientDispatchesRasterizesWritesTransportAndEmitsAck() {
        val transport = InMemoryByteSinkTransport(autoConnect = true)
        val dao = InMemoryPrintJobDao()
        val queue = OfflineJobQueueRepository(dao)
        val fakeConnector = FakeRelayConnector()

        val client = PrintRelayWebSocketClient(
            queueRepository = queue,
            transport = transport,
            connector = fakeConnector,
            paperWidthProvider = { PaperWidth.MM_80 }
        )

        client.connect("http://127.0.0.1:4000", "printer-80mm-01")
        assertEquals(
            "ws://127.0.0.1:4000/ws?printer_id=printer-80mm-01",
            fakeConnector.lastConnectedUrl
        )
        fakeConnector.simulateOpen()

        // Should emit REGISTER frame first
        assertEquals(1, fakeConnector.sentFrames.size)
        val registerJson = MiniJson.parseObject(fakeConnector.sentFrames[0])
        assertEquals("REGISTER", registerJson.stringOrNull("type"))
        assertEquals("printer-80mm-01", registerJson.stringOrNull("printer_id"))

        // Dispatch a JSON_RECEIPT payload containing Urdu RTL footer
        val dispatchedReceipt = MiniJson.encodeObject(
            mapOf(
                "type" to "DISPATCHED",
                "job_id" to "job_ws_001",
                "printer_id" to "printer-80mm-01",
                "payload_type" to "JSON_RECEIPT",
                "payload" to mapOf(
                    "title" to "KARACHI ROASTERY",
                    "items" to listOf(
                        mapOf("name" to "Flat White", "qty" to 1, "price_formatted" to "$4.50")
                    ),
                    "total_formatted" to "TOTAL $4.50",
                    "footer" to "رسید - شکریہ"
                )
            )
        )
        fakeConnector.simulateServerText(dispatchedReceipt)

        // Assert transport received valid 80mm ESC/POS GS v 0 payload
        val written = transport.toByteArray()
        assertTrue(written.size > 72 * 24)
        assertEquals(0x1B.toByte(), written[0])
        assertEquals(0x40.toByte(), written[1])
        assertEquals(0x1D.toByte(), written[2])
        assertEquals(0x76.toByte(), written[3])
        assertEquals(0x30.toByte(), written[4])
        assertEquals(0x00.toByte(), written[5])
        assertEquals(72.toByte(), written[6]) // 80mm xL = 72 bytes

        // Assert job moved to ACK in queue and ACK frame emitted over WebSocket
        assertEquals(JobStatus.ACK, queue.getJob("job_ws_001")?.status)
        assertEquals(2, fakeConnector.sentFrames.size)
        val ackJson = MiniJson.parseObject(fakeConnector.sentFrames[1])
        assertEquals("ACK", ackJson.stringOrNull("type"))
        assertEquals("ACK", ackJson.stringOrNull("status"))
        assertEquals("job_ws_001", ackJson.stringOrNull("job_id"))
        assertEquals("printer-80mm-01", ackJson.stringOrNull("printer_id"))
        assertNotNull(ackJson.stringOrNull("acked_at"))
    }

    @Test
    fun offlineQueuedOrFailedJobReplaysAutomaticallyOnReconnectAndEmitsAck() {
        val transport = InMemoryByteSinkTransport(autoConnect = false)
        val queue = OfflineJobQueueRepository(InMemoryPrintJobDao())
        val fakeConnector = FakeRelayConnector()

        val client = PrintRelayWebSocketClient(
            queueRepository = queue,
            transport = transport,
            connector = fakeConnector,
            paperWidthProvider = { PaperWidth.MM_58 }
        )

        client.connect("http://127.0.0.1:4000", "printer-58-offline")
        fakeConnector.simulateOpen()

        // Make connect() fail while transport is simulated offline
        val offlineClient = PrintRelayWebSocketClient(
            queueRepository = queue,
            transport = object : com.printerapi.agent.transport.EscPosTransport {
                override val isConnected: Boolean = false
                override fun connect() = throw IOException("Bluetooth printer powered off")
                override fun write(bytes: ByteArray) = throw IOException("Offline")
                override fun flush() = Unit
                override fun disconnect() = Unit
            },
            connector = fakeConnector,
            paperWidthProvider = { PaperWidth.MM_58 }
        )
        offlineClient.handleIncomingMessage(
            MiniJson.encodeObject(
                mapOf(
                    "type" to "DISPATCHED",
                    "job_id" to "job_offline_99",
                    "printer_id" to "printer-58-offline",
                    "payload_type" to "HTML",
                    "payload" to mapOf("html" to "<h1>فاتورة ضريبية</h1><p>Order #99</p>")
                )
            )
        )

        assertEquals(JobStatus.FAILED, queue.getJob("job_offline_99")?.status)
        assertEquals(1, fakeConnector.sentFrames.size) // Only REGISTER so far, no ACK

        // Now hardware transport comes back online and WebSocket reconnects
        transport.connect()
        fakeConnector.simulateOpen() // triggers flushPendingQueue()

        assertEquals(JobStatus.ACK, queue.getJob("job_offline_99")?.status)
        assertTrue(transport.toByteArray().isNotEmpty())
        val lastAck = MiniJson.parseObject(fakeConnector.sentFrames.last())
        assertEquals("ACK", lastAck.stringOrNull("type"))
        assertEquals("job_offline_99", lastAck.stringOrNull("job_id"))
    }

    @Test
    fun pairPrinterClientValidatesSixDigitCodeAndPostsContractPayload() {
        var capturedUrl = ""
        var capturedBody = ""
        val mockExecutor = HttpPostExecutor { url, body ->
            capturedUrl = url
            capturedBody = body
            HttpPostResponse(
                statusCode = 200,
                body = """{"printer_id":"uuid-printer-80","name":"Kitchen #1","paper_width_mm":80}"""
            )
        }
        val client = PairPrinterClient(mockExecutor)

        val invalid = client.pairPrinter("http://localhost:4000", "12345", "Test", PaperWidth.MM_58)
        assertTrue(invalid.isFailure)

        val valid = client.pairPrinter("http://localhost:4000/", "482910", "Kitchen #1", PaperWidth.MM_80)
        assertTrue(valid.isSuccess)
        assertEquals("http://localhost:4000/v1/printers/pair", capturedUrl)

        val parsedReq = MiniJson.parseObject(capturedBody)
        assertEquals("482910", parsedReq.stringOrNull("pairing_code"))
        assertEquals("Kitchen #1", parsedReq.stringOrNull("name"))
        assertEquals(80L, parsedReq["paper_width_mm"])

        val paired = valid.getOrThrow()
        assertEquals("uuid-printer-80", paired.printerId)
        assertEquals(PaperWidth.MM_80, paired.paperWidth)
    }

    private fun countBlackPixelsInHorizontalHalf(
        output: RasterizedOutput,
        leftHalf: Boolean
    ): Int {
        val midX = output.widthPx / 2
        val xStart = if (leftHalf) 0 else midX
        val xEnd = if (leftHalf) midX else output.widthPx
        var count = 0
        for (y in 0 until output.heightPx) {
            val rowByteStart = y * output.widthBytes
            for (x in xStart until xEnd) {
                val byteVal = output.rasterData[rowByteStart + (x ushr 3)].toInt() and 0xFF
                val bit = (byteVal ushr (7 - (x and 7))) and 1
                if (bit == 1) count++
            }
        }
        return count
    }

    private class FakeRelayConnector : RelaySocketConnector {
        var lastConnectedUrl: String = ""
        val sentFrames = mutableListOf<String>()
        private var onOpenCb: ((WebSocketFrameSender) -> Unit)? = null
        private var onTextCb: ((String) -> Unit)? = null
        private var sender: FakeSender? = null

        override fun connect(
            wsUrl: String,
            onOpen: (WebSocketFrameSender) -> Unit,
            onTextMessage: (String) -> Unit,
            onClosed: (reason: String?) -> Unit,
            onError: (Throwable) -> Unit
        ): WebSocketFrameSender {
            lastConnectedUrl = wsUrl
            onOpenCb = onOpen
            onTextCb = onTextMessage
            return FakeSender(sentFrames).also { sender = it }
        }

        fun simulateOpen() {
            val active = sender ?: FakeSender(sentFrames).also { sender = it }
            active.open = true
            onOpenCb?.invoke(active)
        }

        fun simulateServerText(json: String) {
            onTextCb?.invoke(json)
        }
    }

    private class FakeSender(
        private val sentFrames: MutableList<String>
    ) : WebSocketFrameSender {
        var open: Boolean = false
        override val isOpen: Boolean
            get() = open

        override fun sendText(frame: String): Boolean {
            if (!open) return false
            sentFrames.add(frame)
            return true
        }

        override fun close() {
            open = false
        }
    }
}
