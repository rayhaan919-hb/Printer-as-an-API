package com.printerapi.agent.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object DesignTokens {
    val BgCanvasLight = Color(0xFFFAFAFA)
    val BgSurfaceLight = Color(0xFFFFFFFF)
    val BorderLight = Color(0xFFE2E8F0)
    val TextPrimaryLight = Color(0xFF09090B)
    val TextSecondaryLight = Color(0xFF52525B)

    val BgCanvasDark = Color(0xFF09090B)
    val BgSurfaceDark = Color(0xFF18181B)
    val BorderDark = Color(0xFF27272A)
    val TextPrimaryDark = Color(0xFFFAFAFA)
    val TextSecondaryDark = Color(0xFFA1A1AA)

    val AccentPrimary = Color(0xFF2563EB) // Cobalt
    val StatusOnline = Color(0xFF10B981) // Emerald
    val StatusOffline = Color(0xFFEF4444) // Rose
    val StatusPending = Color(0xFFF59E0B) // Amber
}

private val LightColors = lightColorScheme(
    primary = DesignTokens.AccentPrimary,
    onPrimary = Color.White,
    background = DesignTokens.BgCanvasLight,
    onBackground = DesignTokens.TextPrimaryLight,
    surface = DesignTokens.BgSurfaceLight,
    onSurface = DesignTokens.TextPrimaryLight,
    surfaceVariant = Color(0xFFF4F4F5),
    onSurfaceVariant = DesignTokens.TextSecondaryLight,
    outline = DesignTokens.BorderLight,
    error = DesignTokens.StatusOffline,
    onError = Color.White
)

private val DarkColors = darkColorScheme(
    primary = DesignTokens.AccentPrimary,
    onPrimary = Color.White,
    background = DesignTokens.BgCanvasDark,
    onBackground = DesignTokens.TextPrimaryDark,
    surface = DesignTokens.BgSurfaceDark,
    onSurface = DesignTokens.TextPrimaryDark,
    surfaceVariant = Color(0xFF27272A),
    onSurfaceVariant = DesignTokens.TextSecondaryDark,
    outline = DesignTokens.BorderDark,
    error = DesignTokens.StatusOffline,
    onError = Color.White
)

private val AgentTypography = Typography(
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
        letterSpacing = (-0.3).sp
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 20.sp
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        fontFeatureSettings = "tnum"
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        fontFeatureSettings = "tnum"
    )
)

@Composable
fun PrintAgentTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colorScheme,
        typography = AgentTypography,
        content = content
    )
}
