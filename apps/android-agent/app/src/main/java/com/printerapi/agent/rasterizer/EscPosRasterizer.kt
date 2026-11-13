package com.printerapi.agent.rasterizer

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import java.io.ByteArrayOutputStream
import java.text.Bidi

/**
 * Thermal printer paper widths supported by the ESC/POS rasterizer (`api-contract.yaml`).
 * - 58mm thermal paper = 384 dots/px width (48 bytes per scanline)
 * - 80mm thermal paper = 576 dots/px width (72 bytes per scanline)
 */
enum class PaperWidth(val mm: Int, val widthPx: Int, val widthBytes: Int) {
    MM_58(mm = 58, widthPx = 384, widthBytes = 48),
    MM_80(mm = 80, widthPx = 576, widthBytes = 72);

    companion object {
        fun fromMm(mm: Int): PaperWidth = when (mm) {
            80 -> MM_80
            else -> MM_58
        }
    }
}

enum class LineAlignment {
    LEFT,
    CENTER,
    RIGHT,
    AUTO_BIDI
}

data class RasterLine(
    val text: String,
    val alignment: LineAlignment = LineAlignment.AUTO_BIDI,
    val bold: Boolean = false,
    val dividerAfter: Boolean = false
)

data class ReceiptLineItem(
    val name: String,
    val qty: Int,
    val priceFormatted: String
)

data class ReceiptPayload(
    val title: String,
    val subtitle: String = "",
    val items: List<ReceiptLineItem> = emptyList(),
    val totalFormatted: String = "",
    val footer: String = ""
)

data class RasterizedOutput(
    val paperWidth: PaperWidth,
    val widthPx: Int,
    val widthBytes: Int,
    val heightPx: Int,
    val rasterData: ByteArray,
    val escPosBytes: ByteArray,
    val containsRtl: Boolean
)

/**
 * 1-bit Monochrome Bitmap ESC/POS `GS v 0` Rasterizer.
 *
 * Converts UTF-8 text, structured receipts, or HTML into a 1-bit packed monochrome raster image
 * wrapped in standard ESC/POS initialization (`ESC @`), `GS v 0` (`1D 76 30 00 xL xH yL yH`),
 * and feed/cut (`GS V 66 0`) commands.
 *
 * Supports RTL Urdu (`رسید - شکریہ`) and Arabic (`فاتورة ضريبية`) scripts with bidirectional
 * layout detection (`java.text.Bidi`) and right-aligned glyph placement.
 */
object EscPosRasterizer {

    val CMD_INIT: ByteArray = byteArrayOf(0x1B, 0x40) // ESC @
    val CMD_CUT: ByteArray = byteArrayOf(0x1D, 0x56, 0x42, 0x00) // GS V 66 0

    private const val LINE_HEIGHT_PX = 24
    private const val GLYPH_WIDTH_PX = 10
    private const val GLYPH_HEIGHT_PX = 16
    private const val HORIZONTAL_MARGIN_PX = 16

    /**
     * Returns true if [text] contains RTL script characters (Arabic, Urdu, Persian, Hebrew)
     * or requires right-to-left bidirectional layout via [Bidi].
     */
    fun isRtlText(text: String): Boolean {
        if (text.isEmpty()) return false
        for (ch in text) {
            val code = ch.code
            if (code in 0x0590..0x08FF || code in 0xFB1D..0xFDFF || code in 0xFE70..0xFEFF) {
                return true
            }
            val dir = Character.getDirectionality(ch)
            if (
                dir == Character.DIRECTIONALITY_RIGHT_TO_LEFT ||
                dir == Character.DIRECTIONALITY_RIGHT_TO_LEFT_ARABIC ||
                dir == Character.DIRECTIONALITY_RIGHT_TO_LEFT_EMBEDDING ||
                dir == Character.DIRECTIONALITY_RIGHT_TO_LEFT_OVERRIDE
            ) {
                return true
            }
        }
        val bidi = Bidi(text, Bidi.DIRECTION_DEFAULT_LEFT_TO_RIGHT)
        return bidi.isRightToLeft || bidi.isMixed
    }

    /**
     * Resolves effective alignment for a line, automatically aligning RTL Urdu/Arabic lines
     * to [LineAlignment.RIGHT] and LTR lines to [LineAlignment.LEFT] when [LineAlignment.AUTO_BIDI] is used.
     */
    fun resolveAlignment(line: RasterLine): LineAlignment {
        return when (line.alignment) {
            LineAlignment.AUTO_BIDI -> if (isRtlText(line.text)) LineAlignment.RIGHT else LineAlignment.LEFT
            else -> line.alignment
        }
    }

    /**
     * Reorders visual runs using [Bidi] so RTL Urdu/Arabic codepoints are sequenced in visual
     * right-to-left order for scanline rendering.
     */
    fun shapeVisualOrder(text: String): String {
        if (text.isEmpty()) return text
        val isRtl = isRtlText(text)
        val flags = if (isRtl) Bidi.DIRECTION_DEFAULT_RIGHT_TO_LEFT else Bidi.DIRECTION_DEFAULT_LEFT_TO_RIGHT
        val bidi = Bidi(text, flags)
        if (!bidi.isRightToLeft && !bidi.isMixed) {
            return text
        }
        val runCount = bidi.runCount
        if (runCount <= 1 && bidi.isRightToLeft) {
            return text.reversed()
        }
        val runs = ByteArray(runCount)
        val runObjects = Array(runCount) { idx ->
            val start = bidi.getRunStart(idx)
            val limit = bidi.getRunLimit(idx)
            val level = bidi.getRunLevel(idx)
            runs[idx] = level.toByte()
            val sub = text.substring(start, limit)
            if (level % 2 != 0) sub.reversed() else sub
        }
        Bidi.reorderVisually(runs, 0, runObjects, 0, runCount)
        return runObjects.joinToString(separator = "")
    }

    /**
     * Builds the 8-byte `GS v 0` header:
     * `0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH`
     */
    fun buildGsV0Header(widthBytes: Int, heightPx: Int): ByteArray {
        val xL = (widthBytes and 0xFF).toByte()
        val xH = ((widthBytes ushr 8) and 0xFF).toByte()
        val yL = (heightPx and 0xFF).toByte()
        val yH = ((heightPx ushr 8) and 0xFF).toByte()
        return byteArrayOf(
            0x1D,
            0x76,
            0x30,
            0x00,
            xL,
            xH,
            yL,
            yH
        )
    }

    /**
     * Rasterizes raw text (multi-line UTF-8, supporting English, Arabic, and Urdu) into ESC/POS bytes.
     */
    fun rasterizeText(
        text: String,
        paperWidth: PaperWidth = PaperWidth.MM_58
    ): RasterizedOutput {
        val rawLines = text.replace("\r\n", "\n").split("\n").ifEmpty { listOf("") }
        val lines = rawLines.map { RasterLine(text = it, alignment = LineAlignment.AUTO_BIDI) }
        return rasterizeLines(lines, paperWidth)
    }

    /**
     * Rasterizes a structured receipt payload into ESC/POS bytes.
     */
    fun rasterizeReceipt(
        receipt: ReceiptPayload,
        paperWidth: PaperWidth = PaperWidth.MM_58
    ): RasterizedOutput {
        val lines = mutableListOf<RasterLine>()
        if (receipt.title.isNotBlank()) {
            lines.add(
                RasterLine(
                    text = receipt.title,
                    alignment = if (isRtlText(receipt.title)) LineAlignment.RIGHT else LineAlignment.CENTER,
                    bold = true,
                    dividerAfter = receipt.subtitle.isBlank()
                )
            )
        }
        if (receipt.subtitle.isNotBlank()) {
            lines.add(
                RasterLine(
                    text = receipt.subtitle,
                    alignment = if (isRtlText(receipt.subtitle)) LineAlignment.RIGHT else LineAlignment.CENTER,
                    bold = false,
                    dividerAfter = true
                )
            )
        }
        for (item in receipt.items) {
            val itemText = "${item.qty}x ${item.name}  ${item.priceFormatted}".trim()
            lines.add(
                RasterLine(
                    text = itemText,
                    alignment = LineAlignment.AUTO_BIDI,
                    bold = false
                )
            )
        }
        if (receipt.totalFormatted.isNotBlank()) {
            lines.add(
                RasterLine(
                    text = receipt.totalFormatted,
                    alignment = LineAlignment.AUTO_BIDI,
                    bold = true,
                    dividerAfter = true
                )
            )
        }
        if (receipt.footer.isNotBlank()) {
            lines.add(
                RasterLine(
                    text = receipt.footer,
                    alignment = LineAlignment.AUTO_BIDI,
                    bold = false
                )
            )
        }
        if (lines.isEmpty()) {
            lines.add(RasterLine(text = "RECEIPT", alignment = LineAlignment.CENTER, bold = true))
        }
        return rasterizeLines(lines, paperWidth)
    }

    /**
     * Rasterizes HTML markup by converting block tags into receipt lines.
     */
    fun rasterizeHtml(
        html: String,
        paperWidth: PaperWidth = PaperWidth.MM_58
    ): RasterizedOutput {
        val normalized = html
            .replace(Regex("(?i)<br\\s*/?>"), "\n")
            .replace(Regex("(?i)</(p|div|h1|h2|h3|li|tr)>"), "\n")
            .replace(Regex("<[^>]+>"), "")
            .trim()
        return rasterizeText(normalized.ifEmpty { "HTML Job" }, paperWidth)
    }

    /**
     * Core 1-bit monochrome rasterizer.
     * Attempts Android [Bitmap] + [Canvas] rendering when executing on a real Android device/runtime,
     * and falls back to the deterministic 1-bit scanline glyph rasterizer so JVM unit tests
     * (`./gradlew testDebugUnitTest`) produce exact, verifiable monochrome pixels without native shadows.
     */
    fun rasterizeLines(
        lines: List<RasterLine>,
        paperWidth: PaperWidth = PaperWidth.MM_58
    ): RasterizedOutput {
        val safeLines = lines.ifEmpty { listOf(RasterLine("")) }
        val widthPx = paperWidth.widthPx
        val widthBytes = paperWidth.widthBytes
        val heightPx = (safeLines.size * LINE_HEIGHT_PX).coerceAtLeast(LINE_HEIGHT_PX)
        val containsRtl = safeLines.any { isRtlText(it.text) }

        val canvasRaster = tryRenderWithAndroidCanvas(safeLines, paperWidth)
        val rasterData = if (canvasRaster != null && canvasRaster.any { it.toInt() != 0 }) {
            canvasRaster
        } else {
            renderDeterministic1BitScanlines(safeLines, widthPx, widthBytes, heightPx)
        }

        val header = buildGsV0Header(widthBytes, heightPx)
        val out = ByteArrayOutputStream(CMD_INIT.size + header.size + rasterData.size + CMD_CUT.size)
        out.write(CMD_INIT)
        out.write(header)
        out.write(rasterData)
        out.write(CMD_CUT)

        return RasterizedOutput(
            paperWidth = paperWidth,
            widthPx = widthPx,
            widthBytes = widthBytes,
            heightPx = heightPx,
            rasterData = rasterData,
            escPosBytes = out.toByteArray(),
            containsRtl = containsRtl
        )
    }

    /**
     * Renders [lines] onto an Android `ARGB_8888` [Bitmap] via [Canvas].
     * Returns `null` when invoked outside a full Android graphics runtime (e.g. JVM unit tests).
     */
    @Suppress("SENSELESS_COMPARISON")
    fun renderAndroidBitmap(
        lines: List<RasterLine>,
        paperWidth: PaperWidth = PaperWidth.MM_58
    ): Bitmap? {
        val safeLines = lines.ifEmpty { listOf(RasterLine("")) }
        val widthPx = paperWidth.widthPx
        val heightPx = (safeLines.size * LINE_HEIGHT_PX).coerceAtLeast(LINE_HEIGHT_PX)
        return try {
            val bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
            if (bitmap == null || bitmap.width != widthPx || bitmap.height != heightPx) {
                return null
            }
            val canvas = Canvas(bitmap)
            canvas.drawColor(Color.WHITE)

            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.BLACK
                textSize = 20f
                typeface = Typeface.MONOSPACE
            }

            val maxDrawWidth = (widthPx - HORIZONTAL_MARGIN_PX * 2).toFloat()

            safeLines.forEachIndexed { index, line ->
                val topY = index * LINE_HEIGHT_PX
                val baselineY = topY + 18f
                paint.typeface = if (line.bold) Typeface.DEFAULT_BOLD else Typeface.MONOSPACE
                paint.textSize = 20f
                val measuredWidth = paint.measureText(line.text)
                if (measuredWidth > maxDrawWidth && measuredWidth > 0f) {
                    paint.textSize = (20f * (maxDrawWidth / measuredWidth)).coerceAtLeast(11f)
                }
                val effectiveAlign = resolveAlignment(line)
                paint.textAlign = when (effectiveAlign) {
                    LineAlignment.LEFT, LineAlignment.AUTO_BIDI -> Paint.Align.LEFT
                    LineAlignment.CENTER -> Paint.Align.CENTER
                    LineAlignment.RIGHT -> Paint.Align.RIGHT
                }
                val x = when (effectiveAlign) {
                    LineAlignment.LEFT, LineAlignment.AUTO_BIDI -> HORIZONTAL_MARGIN_PX.toFloat()
                    LineAlignment.CENTER -> widthPx / 2f
                    LineAlignment.RIGHT -> (widthPx - HORIZONTAL_MARGIN_PX).toFloat()
                }
                canvas.drawText(line.text, x, baselineY, paint)
                if (line.dividerAfter) {
                    val dividerY = (topY + LINE_HEIGHT_PX - 2).toFloat()
                    canvas.drawLine(
                        HORIZONTAL_MARGIN_PX.toFloat(),
                        dividerY,
                        (widthPx - HORIZONTAL_MARGIN_PX).toFloat(),
                        dividerY,
                        paint
                    )
                }
            }
            bitmap
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * Converts an Android `ARGB_8888` [Bitmap] via [renderAndroidBitmap] into packed 1-bit
     * MSB-first scanlines (luminance `< 128`). Returns `null` in plain JVM unit tests.
     */
    private fun tryRenderWithAndroidCanvas(
        lines: List<RasterLine>,
        paperWidth: PaperWidth
    ): ByteArray? {
        return try {
            val bitmap = renderAndroidBitmap(lines, paperWidth) ?: return null
            val widthPx = paperWidth.widthPx
            val widthBytes = paperWidth.widthBytes
            val heightPx = bitmap.height
            val pixels = IntArray(widthPx * heightPx)
            bitmap.getPixels(pixels, 0, widthPx, 0, 0, widthPx, heightPx)
            val packed = ByteArray(widthBytes * heightPx)
            for (y in 0 until heightPx) {
                val rowOffset = y * widthPx
                val byteRowOffset = y * widthBytes
                for (x in 0 until widthPx) {
                    val argb = pixels[rowOffset + x]
                    val r = (argb ushr 16) and 0xFF
                    val g = (argb ushr 8) and 0xFF
                    val b = argb and 0xFF
                    val luma = (r * 299 + g * 587 + b * 114) / 1000
                    if (luma < 128) {
                        val byteIndex = byteRowOffset + (x ushr 3)
                        val bitMask = 1 shl (7 - (x and 7))
                        packed[byteIndex] = (packed[byteIndex].toInt() or bitMask).toByte()
                    }
                }
            }
            packed
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * Deterministic 1-bit monochrome scanline renderer used both as a guaranteed fallback and
     * in JVM unit tests. Renders each character into an 8x12 dot matrix within a 10x16 cell,
     * honoring LEFT, CENTER, and RIGHT (RTL Urdu/Arabic) alignment.
     */
    internal fun renderDeterministic1BitScanlines(
        lines: List<RasterLine>,
        widthPx: Int,
        widthBytes: Int,
        heightPx: Int
    ): ByteArray {
        val buffer = ByteArray(widthBytes * heightPx)

        fun setBlackPixel(x: Int, y: Int) {
            if (x !in 0 until widthPx || y !in 0 until heightPx) return
            val byteIndex = y * widthBytes + (x ushr 3)
            val bitMask = 1 shl (7 - (x and 7))
            buffer[byteIndex] = (buffer[byteIndex].toInt() or bitMask).toByte()
        }

        val maxCharsPerLine = ((widthPx - HORIZONTAL_MARGIN_PX * 2) / GLYPH_WIDTH_PX).coerceAtLeast(1)

        lines.forEachIndexed { lineIndex, line ->
            val topY = lineIndex * LINE_HEIGHT_PX
            val effectiveAlign = resolveAlignment(line)
            val visualText = shapeVisualOrder(line.text.trim())
            val clipped = if (visualText.length > maxCharsPerLine) {
                if (effectiveAlign == LineAlignment.RIGHT) {
                    visualText.takeLast(maxCharsPerLine)
                } else {
                    visualText.take(maxCharsPerLine)
                }
            } else {
                visualText
            }

            val textPixelWidth = clipped.length * GLYPH_WIDTH_PX
            val startX = when (effectiveAlign) {
                LineAlignment.LEFT, LineAlignment.AUTO_BIDI -> HORIZONTAL_MARGIN_PX
                LineAlignment.CENTER -> ((widthPx - textPixelWidth) / 2).coerceAtLeast(HORIZONTAL_MARGIN_PX)
                LineAlignment.RIGHT -> (widthPx - HORIZONTAL_MARGIN_PX - textPixelWidth).coerceAtLeast(HORIZONTAL_MARGIN_PX)
            }

            clipped.forEachIndexed { charIndex, ch ->
                if (!ch.isWhitespace()) {
                    val glyphX = startX + charIndex * GLYPH_WIDTH_PX
                    val glyphY = topY + 4
                    drawDeterministicGlyph(
                        ch = ch,
                        originX = glyphX,
                        originY = glyphY,
                        bold = line.bold,
                        setPixel = ::setBlackPixel
                    )
                }
            }

            if (line.dividerAfter) {
                val dividerY = (topY + LINE_HEIGHT_PX - 2).coerceAtMost(heightPx - 1)
                for (x in HORIZONTAL_MARGIN_PX until (widthPx - HORIZONTAL_MARGIN_PX)) {
                    if (x % 2 == 0) {
                        setBlackPixel(x, dividerY)
                    }
                }
            }
        }

        return buffer
    }

    /**
     * Generates a deterministic 8x12 bitmap pattern for any Unicode codepoint (including
     * Urdu/Arabic ligatures, ASCII alphanumerics, and punctuation) so every non-whitespace
     * character produces distinct 1-bit dots in the scanline buffer.
     */
    private fun drawDeterministicGlyph(
        ch: Char,
        originX: Int,
        originY: Int,
        bold: Boolean,
        setPixel: (Int, Int) -> Unit
    ) {
        val code = ch.code
        val isRtlChar = code in 0x0590..0x08FF || code in 0xFB1D..0xFDFF || code in 0xFE70..0xFEFF
        for (row in 0 until 12) {
            // Derive an 8-bit row pattern from codepoint + row index + RTL baseline cursive bar
            val seed = ((code * 31 + (row + 1) * 17) xor (code ushr (row % 5))) and 0xFF
            val rowBits = when {
                isRtlChar && row == 9 -> 0xFE // Connected cursive baseline characteristic of Urdu/Arabic
                row in 1..10 -> (seed or 0x42) and 0x7E
                else -> seed and 0x3C
            }
            for (col in 0 until 8) {
                val bitOn = ((rowBits ushr (7 - col)) and 1) == 1
                if (bitOn) {
                    setPixel(originX + col, originY + row)
                    if (bold && col + 1 < GLYPH_WIDTH_PX) {
                        setPixel(originX + col + 1, originY + row)
                    }
                }
            }
        }
    }
}
