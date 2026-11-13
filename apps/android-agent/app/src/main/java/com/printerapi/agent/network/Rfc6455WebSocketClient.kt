package com.printerapi.agent.network

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLSocketFactory

/**
 * Outbound WebSocket frame sender abstraction so unit tests can assert emitted `REGISTER`
 * and `ACK` frames without opening real TCP sockets.
 */
interface WebSocketFrameSender {
    val isOpen: Boolean
    fun sendText(frame: String): Boolean
    fun close()
}

/**
 * WebSocket connection factory abstraction (`Rfc6455WebSocketConnector` for runtime,
 * mock connector for JVM unit tests).
 */
interface RelaySocketConnector {
    fun connect(
        wsUrl: String,
        onOpen: (WebSocketFrameSender) -> Unit,
        onTextMessage: (String) -> Unit,
        onClosed: (reason: String?) -> Unit,
        onError: (Throwable) -> Unit
    ): WebSocketFrameSender
}

/**
 * Lightweight RFC 6455 WebSocket client built solely on standard Java `Socket`/`SSLSocketFactory`
 * so `apps/android-agent` runs on API 24+ and offline builds with zero external networking jars.
 */
class Rfc6455WebSocketConnector(
    private val connectTimeoutMs: Int = 8_000
) : RelaySocketConnector {

    override fun connect(
        wsUrl: String,
        onOpen: (WebSocketFrameSender) -> Unit,
        onTextMessage: (String) -> Unit,
        onClosed: (reason: String?) -> Unit,
        onError: (Throwable) -> Unit
    ): WebSocketFrameSender {
        val session = Rfc6455Session(
            wsUrl = wsUrl,
            connectTimeoutMs = connectTimeoutMs,
            onOpen = onOpen,
            onTextMessage = onTextMessage,
            onClosed = onClosed,
            onError = onError
        )
        session.start()
        return session
    }
}

private class Rfc6455Session(
    private val wsUrl: String,
    private val connectTimeoutMs: Int,
    private val onOpen: (WebSocketFrameSender) -> Unit,
    private val onTextMessage: (String) -> Unit,
    private val onClosed: (reason: String?) -> Unit,
    private val onError: (Throwable) -> Unit
) : WebSocketFrameSender {

    companion object {
        private const val WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        private const val OPCODE_CONTINUATION = 0x0
        private const val OPCODE_TEXT = 0x1
        private const val OPCODE_CLOSE = 0x8
        private const val OPCODE_PING = 0x9
        private const val OPCODE_PONG = 0xA
    }

    private val openFlag = AtomicBoolean(false)
    private val closedFlag = AtomicBoolean(false)
    private val writeLock = Any()
    private val rng = SecureRandom()

    @Volatile
    private var socket: Socket? = null

    @Volatile
    private var outputStream: OutputStream? = null

    override val isOpen: Boolean
        get() = openFlag.get() && !closedFlag.get()

    fun start() {
        Thread({
            runSession()
        }, "PrintRelayWsClient").apply {
            isDaemon = true
            start()
        }
    }

    override fun sendText(frame: String): Boolean {
        if (!isOpen) return false
        return try {
            sendFrame(OPCODE_TEXT, frame.toByteArray(StandardCharsets.UTF_8))
            true
        } catch (err: IOException) {
            onError(err)
            close()
            false
        }
    }

    override fun close() {
        if (!closedFlag.compareAndSet(false, true)) return
        val wasOpen = openFlag.getAndSet(false)
        if (wasOpen) {
            try {
                sendFrame(OPCODE_CLOSE, byteArrayOf(0x03, 0xE8.toByte()))
            } catch (_: IOException) {
            }
        }
        try {
            socket?.close()
        } catch (_: IOException) {
        } finally {
            socket = null
            outputStream = null
        }
    }

    private fun runSession() {
        var closeReason: String? = null
        try {
            val uri = URI.create(wsUrl)
            val isSecure = uri.scheme.equals("wss", ignoreCase = true)
            val host = uri.host ?: throw IOException("Missing host in WebSocket URL: $wsUrl")
            val port = if (uri.port != -1) uri.port else if (isSecure) 443 else 80
            val rawPath = uri.rawPath.takeUnless { it.isNullOrEmpty() } ?: "/"
            val pathWithQuery = if (uri.rawQuery.isNullOrEmpty()) rawPath else "$rawPath?${uri.rawQuery}"

            val tcpSocket: Socket = if (isSecure) {
                SSLSocketFactory.getDefault().createSocket().also {
                    it.connect(InetSocketAddress(host, port), connectTimeoutMs)
                }
            } else {
                Socket().also {
                    it.connect(InetSocketAddress(host, port), connectTimeoutMs)
                }
            }

            tcpSocket.soTimeout = connectTimeoutMs
            socket = tcpSocket
            val input = tcpSocket.getInputStream()
            val output = tcpSocket.getOutputStream()
            outputStream = output

            val keyBytes = ByteArray(16).also { rng.nextBytes(it) }
            val secKey = Base64Codec.encode(keyBytes)
            val hostHeader = if ((isSecure && port == 443) || (!isSecure && port == 80)) {
                host
            } else {
                "$host:$port"
            }

            val request = buildString {
                append("GET ").append(pathWithQuery).append(" HTTP/1.1\r\n")
                append("Host: ").append(hostHeader).append("\r\n")
                append("Upgrade: websocket\r\n")
                append("Connection: Upgrade\r\n")
                append("Sec-WebSocket-Key: ").append(secKey).append("\r\n")
                append("Sec-WebSocket-Version: 13\r\n")
                append("\r\n")
            }
            output.write(request.toByteArray(StandardCharsets.US_ASCII))
            output.flush()

            val headersText = readHttpResponseHeaders(input)
            val statusLine = headersText.lineSequence().firstOrNull().orEmpty()
            if (!statusLine.contains(" 101 ")) {
                throw IOException("WebSocket upgrade failed: $statusLine")
            }
            val expectedAccept = computeAcceptKey(secKey)
            val acceptHeader = headersText.lineSequence()
                .map { it.trim() }
                .firstOrNull { it.startsWith("sec-websocket-accept:", ignoreCase = true) }
                ?.substringAfter(':')
                ?.trim()
            if (acceptHeader != null && acceptHeader != expectedAccept) {
                throw IOException("Invalid Sec-WebSocket-Accept header")
            }

            tcpSocket.soTimeout = 0
            openFlag.set(true)
            onOpen(this)

            readFrameLoop(input)
        } catch (err: Throwable) {
            if (!closedFlag.get()) {
                closeReason = err.message
                onError(err)
            }
        } finally {
            openFlag.set(false)
            closedFlag.set(true)
            try {
                socket?.close()
            } catch (_: IOException) {
            }
            onClosed(closeReason)
        }
    }

    private fun readHttpResponseHeaders(input: InputStream): String {
        val buffer = ByteArrayOutputStream()
        var state = 0
        while (true) {
            val b = input.read()
            if (b == -1) throw EOFException("Unexpected EOF during WebSocket handshake")
            buffer.write(b)
            if (buffer.size() > 16_384) {
                throw IOException("HTTP upgrade header exceeded 16 KB")
            }
            state = when {
                state == 0 && b == '\r'.code -> 1
                state == 1 && b == '\n'.code -> 2
                state == 2 && b == '\r'.code -> 3
                state == 3 && b == '\n'.code -> return buffer.toString(StandardCharsets.US_ASCII.name())
                b == '\r'.code -> 1
                else -> 0
            }
        }
    }

    private fun readFrameLoop(input: InputStream) {
        val fragmentedText = ByteArrayOutputStream()
        var collectingText = false

        while (!closedFlag.get()) {
            val b0 = input.read()
            if (b0 == -1) break
            val b1 = input.read()
            if (b1 == -1) break

            val fin = (b0 and 0x80) != 0
            val opcode = b0 and 0x0F
            val masked = (b1 and 0x80) != 0
            var payloadLen = (b1 and 0x7F).toLong()

            if (payloadLen == 126L) {
                val hi = readByteOrThrow(input)
                val lo = readByteOrThrow(input)
                payloadLen = ((hi shl 8) or lo).toLong()
            } else if (payloadLen == 127L) {
                var len = 0L
                repeat(8) {
                    len = (len shl 8) or readByteOrThrow(input).toLong()
                }
                payloadLen = len
            }

            if (payloadLen < 0 || payloadLen > 4 * 1024 * 1024) {
                throw IOException("Unsupported WebSocket frame size: $payloadLen")
            }

            val maskKey = if (masked) readFully(input, 4) else null
            val payload = readFully(input, payloadLen.toInt())
            if (maskKey != null) {
                for (i in payload.indices) {
                    payload[i] = (payload[i].toInt() xor maskKey[i % 4].toInt()).toByte()
                }
            }

            when (opcode) {
                OPCODE_TEXT -> {
                    if (fin) {
                        onTextMessage(String(payload, StandardCharsets.UTF_8))
                    } else {
                        fragmentedText.reset()
                        fragmentedText.write(payload)
                        collectingText = true
                    }
                }
                OPCODE_CONTINUATION -> {
                    if (collectingText) {
                        fragmentedText.write(payload)
                        if (fin) {
                            collectingText = false
                            onTextMessage(String(fragmentedText.toByteArray(), StandardCharsets.UTF_8))
                            fragmentedText.reset()
                        }
                    }
                }
                OPCODE_PING -> {
                    sendFrame(OPCODE_PONG, payload)
                }
                OPCODE_CLOSE -> {
                    close()
                    break
                }
                OPCODE_PONG -> Unit
            }
        }
    }

    private fun sendFrame(opcode: Int, payload: ByteArray) {
        val out = outputStream ?: throw IOException("WebSocket output stream closed")
        val header = ByteArrayOutputStream()
        header.write(0x80 or (opcode and 0x0F))

        val len = payload.size
        when {
            len <= 125 -> header.write(0x80 or len)
            len <= 65_535 -> {
                header.write(0x80 or 126)
                header.write((len ushr 8) and 0xFF)
                header.write(len and 0xFF)
            }
            else -> {
                header.write(0x80 or 127)
                val longLen = len.toLong()
                for (shift in 56 downTo 0 step 8) {
                    header.write(((longLen ushr shift) and 0xFF).toInt())
                }
            }
        }

        val mask = ByteArray(4).also { rng.nextBytes(it) }
        header.write(mask)
        val maskedPayload = ByteArray(len)
        for (i in 0 until len) {
            maskedPayload[i] = (payload[i].toInt() xor mask[i % 4].toInt()).toByte()
        }

        synchronized(writeLock) {
            out.write(header.toByteArray())
            out.write(maskedPayload)
            out.flush()
        }
    }

    private fun readByteOrThrow(input: InputStream): Int {
        val value = input.read()
        if (value == -1) throw EOFException("Unexpected EOF reading WebSocket frame")
        return value
    }

    private fun readFully(input: InputStream, length: Int): ByteArray {
        val buffer = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val read = input.read(buffer, offset, length - offset)
            if (read == -1) throw EOFException("Unexpected EOF reading WebSocket payload")
            offset += read
        }
        return buffer
    }

    private fun computeAcceptKey(secKey: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
            .digest((secKey + WS_GUID).toByteArray(StandardCharsets.US_ASCII))
        return Base64Codec.encode(digest)
    }
}

/**
 * Pure-Kotlin Base64 encoder compatible with Android API 24+ and JVM unit tests.
 */
internal object Base64Codec {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    fun encode(input: ByteArray): String {
        val out = StringBuilder(((input.size + 2) / 3) * 4)
        var i = 0
        while (i < input.size) {
            val b0 = input[i].toInt() and 0xFF
            val hasB1 = i + 1 < input.size
            val hasB2 = i + 2 < input.size
            val b1 = if (hasB1) input[i + 1].toInt() and 0xFF else 0
            val b2 = if (hasB2) input[i + 2].toInt() and 0xFF else 0

            val triple = (b0 shl 16) or (b1 shl 8) or b2
            out.append(ALPHABET[(triple ushr 18) and 0x3F])
            out.append(ALPHABET[(triple ushr 12) and 0x3F])
            out.append(if (hasB1) ALPHABET[(triple ushr 6) and 0x3F] else '=')
            out.append(if (hasB2) ALPHABET[triple and 0x3F] else '=')
            i += 3
        }
        return out.toString()
    }
}
