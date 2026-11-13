package com.printerapi.agent.transport

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothSocket
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Abstraction for ESC/POS thermal printer hardware transport (`tests/mocks.md`).
 * Allows swapping physical Bluetooth RFCOMM SPP (`BluetoothTransport`) with
 * `InMemoryByteSinkTransport` in JUnit tests to verify exact `GS v 0` raster headers.
 */
interface EscPosTransport {
    val isConnected: Boolean

    @Throws(IOException::class)
    fun connect()

    @Throws(IOException::class)
    fun write(bytes: ByteArray)

    @Throws(IOException::class)
    fun flush()

    fun disconnect()
}

/**
 * Physical Android Bluetooth RFCOMM SPP (`00001101-0000-1000-8000-00805F9B34FB`) implementation.
 */
class BluetoothTransport(
    private val macAddress: String,
    @Suppress("DEPRECATION")
    private val bluetoothAdapterProvider: () -> BluetoothAdapter? = { BluetoothAdapter.getDefaultAdapter() }
) : EscPosTransport {

    companion object {
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    private var socket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null

    override val isConnected: Boolean
        get() = socket?.isConnected == true && outputStream != null

    @SuppressLint("MissingPermission")
    @Throws(IOException::class)
    override fun connect() {
        if (isConnected) return
        val adapter = bluetoothAdapterProvider()
            ?: throw IOException("BluetoothAdapter is unavailable on this device")
        val device = try {
            adapter.getRemoteDevice(macAddress)
        } catch (err: IllegalArgumentException) {
            throw IOException("Invalid Bluetooth MAC address: $macAddress", err)
        }
        val rfcommSocket = device.createRfcommSocketToServiceRecord(SPP_UUID)
        adapter.cancelDiscovery()
        rfcommSocket.connect()
        socket = rfcommSocket
        outputStream = rfcommSocket.outputStream
    }

    @Throws(IOException::class)
    override fun write(bytes: ByteArray) {
        val out = outputStream ?: throw IOException("BluetoothTransport is not connected")
        out.write(bytes)
    }

    @Throws(IOException::class)
    override fun flush() {
        val out = outputStream ?: throw IOException("BluetoothTransport is not connected")
        out.flush()
    }

    override fun disconnect() {
        try {
            outputStream?.close()
        } catch (_: IOException) {
        } finally {
            outputStream = null
        }
        try {
            socket?.close()
        } catch (_: IOException) {
        } finally {
            socket = null
        }
    }
}

/**
 * Offline mock transport (`tests/mocks.md`) recording every written chunk and the full
 * concatenated byte stream so `./gradlew testDebugUnitTest` can assert exact ESC/POS
 * `GS v 0` headers and 1-bit raster payloads without physical Bluetooth hardware.
 */
class InMemoryByteSinkTransport(
    autoConnect: Boolean = true
) : EscPosTransport {

    private val sink = ByteArrayOutputStream()
    private val chunks = CopyOnWriteArrayList<ByteArray>()
    private var connected: Boolean = autoConnect
    var flushCount: Int = 0
        private set

    override val isConnected: Boolean
        get() = connected

    override fun connect() {
        connected = true
    }

    override fun write(bytes: ByteArray) {
        if (!connected) {
            throw IOException("InMemoryByteSinkTransport is not connected")
        }
        val copy = bytes.copyOf()
        chunks.add(copy)
        synchronized(sink) {
            sink.write(copy)
        }
    }

    override fun flush() {
        if (!connected) {
            throw IOException("InMemoryByteSinkTransport is not connected")
        }
        flushCount += 1
    }

    override fun disconnect() {
        connected = false
    }

    fun toByteArray(): ByteArray = synchronized(sink) {
        sink.toByteArray()
    }

    fun writtenChunks(): List<ByteArray> = chunks.map { it.copyOf() }

    fun reset() {
        synchronized(sink) {
            sink.reset()
        }
        chunks.clear()
        flushCount = 0
    }
}
