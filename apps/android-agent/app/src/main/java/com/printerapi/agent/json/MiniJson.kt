package com.printerapi.agent.json

/**
 * Pure-Kotlin RFC 8259 JSON parser and serializer with zero Android/Maven dependencies.
 *
 * Unlike `org.json.JSONObject` (which is stubbed out in `android.jar` during JVM unit tests),
 * [MiniJson] runs identically on Android devices and inside `./gradlew testDebugUnitTest`.
 */
object MiniJson {

    fun parseObject(json: String): Map<String, Any?> {
        val trimmed = json.trim()
        if (trimmed.isEmpty()) return emptyMap()
        val parsed = Parser(trimmed).parse()
        @Suppress("UNCHECKED_CAST")
        return parsed as? Map<String, Any?>
            ?: throw IllegalArgumentException("Expected JSON object")
    }

    fun parseValue(json: String): Any? = Parser(json).parse()

    fun encodeObject(map: Map<String, Any?>): String = encodeValue(map)

    fun encodeValue(value: Any?): String = when (value) {
        null -> "null"
        is Boolean -> value.toString()
        is Int, is Long, is Short, is Byte -> value.toString()
        is Float, is Double -> {
            val d = (value as Number).toDouble()
            if (d.isNaN() || d.isInfinite()) "null" else d.toString()
        }
        is Number -> value.toString()
        is String -> encodeString(value)
        is Map<*, *> -> buildString {
            append('{')
            var first = true
            for ((k, v) in value) {
                if (k == null) continue
                if (!first) append(',')
                first = false
                append(encodeString(k.toString()))
                append(':')
                append(encodeValue(v))
            }
            append('}')
        }
        is Iterable<*> -> buildString {
            append('[')
            var first = true
            for (item in value) {
                if (!first) append(',')
                first = false
                append(encodeValue(item))
            }
            append(']')
        }
        is Array<*> -> encodeValue(value.toList())
        else -> encodeString(value.toString())
    }

    fun encodeString(value: String): String = buildString(value.length + 2) {
        append('"')
        for (ch in value) {
            when (ch) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch.code < 0x20) {
                    append("\\u")
                    append(ch.code.toString(16).padStart(4, '0'))
                } else {
                    append(ch)
                }
            }
        }
        append('"')
    }

    private class Parser(private val src: String) {
        private var pos = 0

        fun parse(): Any? {
            skipWhitespace()
            if (pos >= src.length) throw IllegalArgumentException("Empty JSON input")
            val result = readValue()
            skipWhitespace()
            if (pos < src.length) {
                throw IllegalArgumentException("Unexpected trailing JSON character at $pos")
            }
            return result
        }

        private fun readValue(): Any? {
            skipWhitespace()
            if (pos >= src.length) throw IllegalArgumentException("Unexpected end of JSON")
            return when (src[pos]) {
                '{' -> readObject()
                '[' -> readArray()
                '"' -> readString()
                't', 'f' -> readBoolean()
                'n' -> readNull()
                '-', in '0'..'9' -> readNumber()
                else -> throw IllegalArgumentException("Unexpected JSON char '${src[pos]}' at $pos")
            }
        }

        private fun readObject(): Map<String, Any?> {
            expect('{')
            val map = linkedMapOf<String, Any?>()
            skipWhitespace()
            if (peek('}')) {
                pos++
                return map
            }
            while (true) {
                skipWhitespace()
                val key = readString()
                skipWhitespace()
                expect(':')
                val value = readValue()
                map[key] = value
                skipWhitespace()
                if (peek(',')) {
                    pos++
                } else if (peek('}')) {
                    pos++
                    return map
                } else {
                    throw IllegalArgumentException("Expected ',' or '}' at $pos")
                }
            }
        }

        private fun readArray(): List<Any?> {
            expect('[')
            val list = mutableListOf<Any?>()
            skipWhitespace()
            if (peek(']')) {
                pos++
                return list
            }
            while (true) {
                list.add(readValue())
                skipWhitespace()
                if (peek(',')) {
                    pos++
                } else if (peek(']')) {
                    pos++
                    return list
                } else {
                    throw IllegalArgumentException("Expected ',' or ']' at $pos")
                }
            }
        }

        private fun readString(): String {
            expect('"')
            val sb = StringBuilder()
            while (pos < src.length) {
                val ch = src[pos++]
                when (ch) {
                    '"' -> return sb.toString()
                    '\\' -> {
                        if (pos >= src.length) throw IllegalArgumentException("Unterminated JSON escape")
                        val esc = src[pos++]
                        when (esc) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (pos + 4 > src.length) {
                                    throw IllegalArgumentException("Invalid unicode escape at $pos")
                                }
                                val hex = src.substring(pos, pos + 4)
                                sb.append(hex.toInt(16).toChar())
                                pos += 4
                            }
                            else -> throw IllegalArgumentException("Invalid JSON escape '\\$esc'")
                        }
                    }
                    else -> sb.append(ch)
                }
            }
            throw IllegalArgumentException("Unterminated JSON string")
        }

        private fun readBoolean(): Boolean {
            return if (src.startsWith("true", pos)) {
                pos += 4
                true
            } else if (src.startsWith("false", pos)) {
                pos += 5
                false
            } else {
                throw IllegalArgumentException("Invalid boolean at $pos")
            }
        }

        private fun readNull(): Any? {
            if (src.startsWith("null", pos)) {
                pos += 4
                return null
            }
            throw IllegalArgumentException("Invalid null literal at $pos")
        }

        private fun readNumber(): Number {
            val start = pos
            if (peek('-')) pos++
            var isFloat = false
            while (pos < src.length && src[pos] in '0'..'9') pos++
            if (peek('.')) {
                isFloat = true
                pos++
                while (pos < src.length && src[pos] in '0'..'9') pos++
            }
            if (peek('e') || peek('E')) {
                isFloat = true
                pos++
                if (peek('+') || peek('-')) pos++
                while (pos < src.length && src[pos] in '0'..'9') pos++
            }
            val token = src.substring(start, pos)
            return if (isFloat) {
                token.toDouble()
            } else {
                token.toLongOrNull() ?: token.toDouble()
            }
        }

        private fun skipWhitespace() {
            while (pos < src.length && src[pos] in charArrayOf(' ', '\t', '\n', '\r')) {
                pos++
            }
        }

        private fun peek(expected: Char): Boolean = pos < src.length && src[pos] == expected

        private fun expect(expected: Char) {
            if (pos >= src.length || src[pos] != expected) {
                throw IllegalArgumentException("Expected '$expected' at $pos")
            }
            pos++
        }
    }
}

fun Map<String, Any?>.stringOrNull(vararg keys: String): String? {
    for (key in keys) {
        val value = this[key]
        if (value != null) {
            val text = value.toString()
            if (text.isNotBlank()) return text
        }
    }
    return null
}

fun Map<String, Any?>.intOrNull(vararg keys: String): Int? {
    for (key in keys) {
        val value = this[key]
        if (value is Number) return value.toInt()
        if (value is String) value.toIntOrNull()?.let { return it }
    }
    return null
}

@Suppress("UNCHECKED_CAST")
fun Map<String, Any?>.mapOrNull(vararg keys: String): Map<String, Any?>? {
    for (key in keys) {
        val value = this[key] as? Map<String, Any?>
        if (value != null) return value
    }
    return null
}

fun Map<String, Any?>.listOrNull(vararg keys: String): List<Any?>? {
    for (key in keys) {
        val value = this[key] as? List<Any?>
        if (value != null) return value
    }
    return null
}
