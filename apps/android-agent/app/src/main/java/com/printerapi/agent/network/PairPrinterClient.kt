package com.printerapi.agent.network

import com.printerapi.agent.json.MiniJson
import com.printerapi.agent.json.intOrNull
import com.printerapi.agent.json.stringOrNull
import com.printerapi.agent.rasterizer.PaperWidth
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

data class HttpPostResponse(
    val statusCode: Int,
    val body: String
)

fun interface HttpPostExecutor {
    @Throws(IOException::class)
    fun postJson(url: String, jsonBody: String): HttpPostResponse
}

data class PairedPrinterResult(
    val printerId: String,
    val name: String,
    val pairingCode: String,
    val paperWidth: PaperWidth
)

/**
 * REST client for `POST /v1/printers/pair` (`api-contract.yaml`).
 * Validates the 6-digit pairing code and sends printer name + paper width (`58` or `80`).
 */
class PairPrinterClient(
    private val httpExecutor: HttpPostExecutor = DefaultHttpPostExecutor()
) {

    companion object {
        private val SIX_DIGIT_REGEX = Regex("^\\d{6}$")
    }

    fun pairPrinter(
        apiBaseUrl: String,
        pairingCode: String,
        printerName: String,
        paperWidth: PaperWidth
    ): Result<PairedPrinterResult> {
        val cleanCode = pairingCode.trim()
        if (!SIX_DIGIT_REGEX.matches(cleanCode)) {
            return Result.failure(
                IllegalArgumentException("Pairing code must be exactly 6 numeric digits")
            )
        }
        val cleanName = printerName.trim().ifEmpty { "Android Thermal Agent" }
        val normalizedBase = apiBaseUrl.trim().trimEnd('/')
        val endpoint = "$normalizedBase/v1/printers/pair"

        val bodyJson = MiniJson.encodeObject(
            mapOf(
                "pairing_code" to cleanCode,
                "name" to cleanName,
                "paper_width_mm" to paperWidth.mm
            )
        )

        return try {
            val response = httpExecutor.postJson(endpoint, bodyJson)
            if (response.statusCode !in 200..299) {
                val parsedErr = runCatching {
                    MiniJson.parseObject(response.body).stringOrNull("error", "message")
                }.getOrNull()
                return Result.failure(
                    IOException(parsedErr ?: "Pairing failed with HTTP ${response.statusCode}")
                )
            }
            val data = if (response.body.isBlank()) {
                emptyMap()
            } else {
                MiniJson.parseObject(response.body)
            }
            val nestedPrinter = data["printer"] as? Map<*, *>
            @Suppress("UNCHECKED_CAST")
            val printerMap = nestedPrinter as? Map<String, Any?> ?: data

            val printerId = printerMap.stringOrNull("printer_id", "id")
                ?: data.stringOrNull("printer_id", "id")
                ?: "paired-$cleanCode"
            val resolvedName = printerMap.stringOrNull("name") ?: cleanName
            val resolvedWidth = PaperWidth.fromMm(
                printerMap.intOrNull("paper_width_mm") ?: paperWidth.mm
            )
            val resolvedCode = printerMap.stringOrNull("pairing_code") ?: cleanCode

            Result.success(
                PairedPrinterResult(
                    printerId = printerId,
                    name = resolvedName,
                    pairingCode = resolvedCode,
                    paperWidth = resolvedWidth
                )
            )
        } catch (err: Throwable) {
            Result.failure(err)
        }
    }
}

class DefaultHttpPostExecutor(
    private val timeoutMs: Int = 8_000
) : HttpPostExecutor {
    override fun postJson(url: String, jsonBody: String): HttpPostResponse {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
        }
        return try {
            val bytes = jsonBody.toByteArray(StandardCharsets.UTF_8)
            connection.outputStream.use { out ->
                out.write(bytes)
                out.flush()
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            HttpPostResponse(statusCode = code, body = text)
        } finally {
            connection.disconnect()
        }
    }
}
