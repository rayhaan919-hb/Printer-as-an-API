package com.printerapi.agent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.printerapi.agent.queue.JobStatus
import com.printerapi.agent.queue.PrintJobEntity
import com.printerapi.agent.rasterizer.PaperWidth
import com.printerapi.agent.service.AgentUiState
import com.printerapi.agent.service.TransportMode
import com.printerapi.agent.ui.theme.DesignTokens

@Composable
fun AgentDashboardScreen(
    state: AgentUiState,
    onApiBaseUrlChange: (String) -> Unit,
    onPairingCodeChange: (String) -> Unit,
    onPrinterNameChange: (String) -> Unit,
    onPaperWidthSelect: (PaperWidth) -> Unit,
    onTransportModeSelect: (TransportMode) -> Unit,
    onBluetoothMacChange: (String) -> Unit,
    onPairAgentClick: () -> Unit,
    onToggleServiceClick: () -> Unit,
    onTestPrintClick: () -> Unit,
    onFlushQueueClick: () -> Unit,
    onClearAckedClick: () -> Unit,
    onRetryErrorClick: () -> Unit,
    onDismissErrorClick: () -> Unit
) {
    val borderColor = MaterialTheme.colorScheme.outline
    val surfaceColor = MaterialTheme.colorScheme.surface

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                AgentHeaderCard(
                    state = state,
                    borderColor = borderColor,
                    surfaceColor = surfaceColor
                )
            }

            if (state.errorBanner != null) {
                item {
                    InlineErrorBanner(
                        message = state.errorBanner,
                        onRetry = onRetryErrorClick,
                        onDismiss = onDismissErrorClick
                    )
                }
            }

            item {
                PairingConfigurationCard(
                    state = state,
                    borderColor = borderColor,
                    surfaceColor = surfaceColor,
                    onApiBaseUrlChange = onApiBaseUrlChange,
                    onPairingCodeChange = onPairingCodeChange,
                    onPrinterNameChange = onPrinterNameChange,
                    onPaperWidthSelect = onPaperWidthSelect,
                    onTransportModeSelect = onTransportModeSelect,
                    onBluetoothMacChange = onBluetoothMacChange,
                    onPairAgentClick = onPairAgentClick
                )
            }

            item {
                ServiceControlCard(
                    state = state,
                    borderColor = borderColor,
                    surfaceColor = surfaceColor,
                    onToggleServiceClick = onToggleServiceClick,
                    onTestPrintClick = onTestPrintClick,
                    onFlushQueueClick = onFlushQueueClick
                )
            }

            item {
                QueueSectionHeader(
                    jobs = state.jobs,
                    onClearAckedClick = onClearAckedClick
                )
            }

            when {
                state.isLoadingQueue -> {
                    item {
                        QueueSkeletonLoader(borderColor = borderColor, surfaceColor = surfaceColor)
                    }
                }
                state.jobs.isEmpty() -> {
                    item {
                        QueueEmptyState(
                            borderColor = borderColor,
                            surfaceColor = surfaceColor,
                            onTestPrintClick = onTestPrintClick
                        )
                    }
                }
                else -> {
                    items(items = state.jobs, key = { it.jobId }) { job ->
                        OfflineJobRow(
                            job = job,
                            borderColor = borderColor,
                            surfaceColor = surfaceColor
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AgentHeaderCard(
    state: AgentUiState,
    borderColor: Color,
    surfaceColor: Color
) {
    Surface(
        color = surfaceColor,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, borderColor),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ThermalPrinterGlyph(
                        color = DesignTokens.AccentPrimary,
                        modifier = Modifier.size(24.dp)
                    )
                    Column {
                        Text(
                            text = "Print Agent SDK",
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = if (state.isPaired) {
                                "ID ${state.pairedPrinterId.take(18)}"
                            } else {
                                "ESC/POS Relay & Offline Queue"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                StatusPill(
                    label = if (state.isWsConnected) "ONLINE" else "OFFLINE",
                    dotColor = if (state.isWsConnected) DesignTokens.StatusOnline else DesignTokens.StatusOffline
                )
            }

            HorizontalDivider(thickness = 1.dp, color = borderColor)

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (state.isServiceRunning) "Foreground Service: ACTIVE" else "Foreground Service: STOPPED",
                    style = MaterialTheme.typography.labelMedium,
                    color = if (state.isServiceRunning) DesignTokens.StatusOnline else MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "${state.paperWidth.mm}mm • ${state.paperWidth.widthPx}px",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun InlineErrorBanner(
    message: String,
    onRetry: () -> Unit,
    onDismiss: () -> Unit
) {
    Surface(
        color = DesignTokens.StatusOffline.copy(alpha = 0.08f),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, DesignTokens.StatusOffline),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = DesignTokens.StatusOffline,
                modifier = Modifier.weight(1f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onRetry) {
                    Text(text = "Retry", color = DesignTokens.StatusOffline, fontWeight = FontWeight.SemiBold)
                }
                TextButton(onClick = onDismiss) {
                    Text(text = "Dismiss", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun PairingConfigurationCard(
    state: AgentUiState,
    borderColor: Color,
    surfaceColor: Color,
    onApiBaseUrlChange: (String) -> Unit,
    onPairingCodeChange: (String) -> Unit,
    onPrinterNameChange: (String) -> Unit,
    onPaperWidthSelect: (PaperWidth) -> Unit,
    onTransportModeSelect: (TransportMode) -> Unit,
    onBluetoothMacChange: (String) -> Unit,
    onPairAgentClick: () -> Unit
) {
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = DesignTokens.AccentPrimary,
        unfocusedBorderColor = borderColor
    )

    Surface(
        color = surfaceColor,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, borderColor),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                text = "Pair Printer Agent",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedTextField(
                    value = state.pairingCode,
                    onValueChange = onPairingCodeChange,
                    label = { Text("6-Digit Code") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    textStyle = TextStyle(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                        letterSpacing = 2.sp,
                        fontFeatureSettings = "tnum"
                    ),
                    colors = fieldColors,
                    modifier = Modifier.weight(0.45f)
                )

                OutlinedTextField(
                    value = state.printerName,
                    onValueChange = onPrinterNameChange,
                    label = { Text("Printer Name") },
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.weight(0.55f)
                )
            }

            OutlinedTextField(
                value = state.apiBaseUrl,
                onValueChange = onApiBaseUrlChange,
                label = { Text("Relay API URL") },
                singleLine = true,
                textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp),
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth()
            )

            Text(
                text = "Thermal Paper Width",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(PaperWidth.MM_58, PaperWidth.MM_80).forEach { width ->
                    val selected = state.paperWidth == width
                    FilterChip(
                        selected = selected,
                        onClick = { onPaperWidthSelect(width) },
                        label = {
                            Text(
                                text = "${width.mm}mm (${width.widthPx}px)",
                                style = MaterialTheme.typography.labelMedium
                            )
                        },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = DesignTokens.AccentPrimary.copy(alpha = 0.14f),
                            selectedLabelColor = DesignTokens.AccentPrimary
                        ),
                        border = FilterChipDefaults.filterChipBorder(
                            enabled = true,
                            selected = selected,
                            borderColor = borderColor,
                            selectedBorderColor = DesignTokens.AccentPrimary
                        )
                    )
                }
            }

            Text(
                text = "ESC/POS Hardware Transport",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val isMock = state.transportMode == TransportMode.IN_MEMORY_MOCK
                FilterChip(
                    selected = isMock,
                    onClick = { onTransportModeSelect(TransportMode.IN_MEMORY_MOCK) },
                    label = { Text("Mock Byte Sink", style = MaterialTheme.typography.labelMedium) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = DesignTokens.AccentPrimary.copy(alpha = 0.14f),
                        selectedLabelColor = DesignTokens.AccentPrimary
                    )
                )
                FilterChip(
                    selected = !isMock,
                    onClick = { onTransportModeSelect(TransportMode.BLUETOOTH_SPP) },
                    label = { Text("Bluetooth SPP", style = MaterialTheme.typography.labelMedium) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = DesignTokens.AccentPrimary.copy(alpha = 0.14f),
                        selectedLabelColor = DesignTokens.AccentPrimary
                    )
                )
            }

            if (state.transportMode == TransportMode.BLUETOOTH_SPP) {
                OutlinedTextField(
                    value = state.bluetoothMac,
                    onValueChange = onBluetoothMacChange,
                    label = { Text("Bluetooth MAC Address") },
                    singleLine = true,
                    textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp),
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Button(
                    onClick = onPairAgentClick,
                    enabled = !state.isPairingInProgress && state.pairingCode.length == 6,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = DesignTokens.AccentPrimary,
                        contentColor = Color.White
                    ),
                    shape = RoundedCornerShape(6.dp)
                ) {
                    if (state.isPairingInProgress) {
                        CircularProgressIndicator(
                            color = Color.White,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    Text(text = "Pair Agent", fontWeight = FontWeight.SemiBold)
                }

                if (state.statusNote != null) {
                    Text(
                        text = state.statusNote,
                        style = MaterialTheme.typography.labelSmall,
                        color = DesignTokens.StatusOnline,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .padding(start = 12.dp)
                            .weight(1f)
                    )
                }
            }
        }
    }
}

@Composable
private fun ServiceControlCard(
    state: AgentUiState,
    borderColor: Color,
    surfaceColor: Color,
    onToggleServiceClick: () -> Unit,
    onTestPrintClick: () -> Unit,
    onFlushQueueClick: () -> Unit
) {
    Surface(
        color = surfaceColor,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, borderColor),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                text = "Foreground Relay & Rasterizer",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onToggleServiceClick,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (state.isServiceRunning) DesignTokens.StatusOffline else DesignTokens.AccentPrimary,
                        contentColor = Color.White
                    ),
                    shape = RoundedCornerShape(6.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = if (state.isServiceRunning) "Stop Service" else "Start Service",
                        fontWeight = FontWeight.SemiBold
                    )
                }

                OutlinedButton(
                    onClick = onTestPrintClick,
                    border = BorderStroke(1.dp, borderColor),
                    shape = RoundedCornerShape(6.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = "Test Print",
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            val pendingCount = state.jobs.count { it.status != JobStatus.ACK }
            if (pendingCount > 0) {
                OutlinedButton(
                    onClick = onFlushQueueClick,
                    border = BorderStroke(1.dp, DesignTokens.AccentPrimary),
                    shape = RoundedCornerShape(6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "Flush $pendingCount Pending Offline Job(s)",
                        color = DesignTokens.AccentPrimary
                    )
                }
            }

            if (state.lastRasterHeaderHex != null && state.lastRasterSummary != null) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(6.dp))
                        .border(1.dp, borderColor, RoundedCornerShape(6.dp))
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = state.lastRasterSummary,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = "GS v 0: ${state.lastRasterHeaderHex}",
                        style = MaterialTheme.typography.labelSmall,
                        color = DesignTokens.AccentPrimary
                    )
                }
            }
        }
    }
}

@Composable
private fun QueueSectionHeader(
    jobs: List<PrintJobEntity>,
    onClearAckedClick: () -> Unit
) {
    val queued = jobs.count { it.status == JobStatus.QUEUED }
    val printing = jobs.count { it.status == JobStatus.PRINTING }
    val acked = jobs.count { it.status == JobStatus.ACK }
    val failed = jobs.count { it.status == JobStatus.FAILED }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Offline Job Queue",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground
            )
            if (acked > 0) {
                TextButton(onClick = onClearAckedClick) {
                    Text(text = "Clear ACK ($acked)", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            QueueCountBadge("QUEUED", queued, DesignTokens.StatusPending, Modifier.weight(1f))
            QueueCountBadge("PRINTING", printing, DesignTokens.AccentPrimary, Modifier.weight(1f))
            QueueCountBadge("ACK", acked, DesignTokens.StatusOnline, Modifier.weight(1f))
            QueueCountBadge("FAILED", failed, DesignTokens.StatusOffline, Modifier.weight(1f))
        }
    }
}

@Composable
private fun QueueCountBadge(
    label: String,
    count: Int,
    accent: Color,
    modifier: Modifier = Modifier
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(6.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.Start
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.titleMedium.copy(
                    fontFamily = FontFamily.Monospace,
                    fontFeatureSettings = "tnum"
                ),
                color = accent
            )
        }
    }
}

@Composable
private fun QueueSkeletonLoader(
    borderColor: Color,
    surfaceColor: Color
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(3) {
            Surface(
                color = surfaceColor,
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, borderColor),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(68.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(
                            modifier = Modifier
                                .width(140.dp)
                                .height(12.dp)
                                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp))
                        )
                        Box(
                            modifier = Modifier
                                .width(90.dp)
                                .height(10.dp)
                                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp))
                        )
                    }
                    Box(
                        modifier = Modifier
                            .width(64.dp)
                            .height(22.dp)
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp))
                    )
                }
            }
        }
    }
}

@Composable
private fun QueueEmptyState(
    borderColor: Color,
    surfaceColor: Color,
    onTestPrintClick: () -> Unit
) {
    Surface(
        color = surfaceColor,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, borderColor),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            ThermalPrinterGlyph(
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(32.dp)
            )
            Text(
                text = "No print jobs persisted in the offline queue yet.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Button(
                onClick = onTestPrintClick,
                colors = ButtonDefaults.buttonColors(
                    containerColor = DesignTokens.AccentPrimary,
                    contentColor = Color.White
                ),
                shape = RoundedCornerShape(6.dp)
            ) {
                Text(text = "Run Test Print", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun OfflineJobRow(
    job: PrintJobEntity,
    borderColor: Color,
    surfaceColor: Color
) {
    val badgeColor = when (job.status) {
        JobStatus.QUEUED -> DesignTokens.StatusPending
        JobStatus.PRINTING -> DesignTokens.AccentPrimary
        JobStatus.ACK -> DesignTokens.StatusOnline
        JobStatus.FAILED -> DesignTokens.StatusOffline
    }

    Surface(
        color = surfaceColor,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, borderColor),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = job.jobId,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "${job.payloadType} • retries=${job.retryCount}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                StatusPill(label = job.status.name, dotColor = badgeColor)
            }

            if (!job.errorMessage.isNullOrBlank()) {
                Text(
                    text = job.errorMessage,
                    style = MaterialTheme.typography.labelSmall,
                    color = DesignTokens.StatusOffline,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun StatusPill(
    label: String,
    dotColor: Color
) {
    Row(
        modifier = Modifier
            .background(dotColor.copy(alpha = 0.12f), RoundedCornerShape(999.dp))
            .border(1.dp, dotColor.copy(alpha = 0.35f), RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Box(
            modifier = Modifier
                .size(6.dp)
                .background(dotColor, CircleShape)
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = dotColor
        )
    }
}

@Composable
private fun ThermalPrinterGlyph(
    color: Color,
    modifier: Modifier = Modifier
) {
    Canvas(modifier = modifier) {
        val strokeWidth = size.minDimension * 0.085f
        val stroke = Stroke(width = strokeWidth)
        // Top paper feed
        drawRoundRect(
            color = color,
            topLeft = Offset(size.width * 0.25f, size.height * 0.1f),
            size = Size(size.width * 0.5f, size.height * 0.25f),
            cornerRadius = CornerRadius(2f, 2f),
            style = stroke
        )
        // Printer chassis
        drawRoundRect(
            color = color,
            topLeft = Offset(size.width * 0.1f, size.height * 0.33f),
            size = Size(size.width * 0.8f, size.height * 0.38f),
            cornerRadius = CornerRadius(4f, 4f),
            style = stroke
        )
        // Receipt output strip
        drawRoundRect(
            color = color,
            topLeft = Offset(size.width * 0.25f, size.height * 0.58f),
            size = Size(size.width * 0.5f, size.height * 0.32f),
            cornerRadius = CornerRadius(2f, 2f),
            style = stroke
        )
    }
}
