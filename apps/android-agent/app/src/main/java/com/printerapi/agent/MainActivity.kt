package com.printerapi.agent

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.printerapi.agent.service.AgentRuntimeController
import com.printerapi.agent.service.AgentUiState
import com.printerapi.agent.service.PrintAgentForegroundService
import com.printerapi.agent.service.TransportMode
import com.printerapi.agent.ui.AgentDashboardScreen
import com.printerapi.agent.ui.theme.PrintAgentTheme

class MainActivity : ComponentActivity() {

    private var pendingServiceStart = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        if (pendingServiceStart) {
            pendingServiceStart = false
            PrintAgentForegroundService.startService(applicationContext)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AgentRuntimeController.ensureInitialized(applicationContext)
        val mainHandler = Handler(Looper.getMainLooper())

        setContent {
            PrintAgentTheme {
                var uiState by remember { mutableStateOf(AgentRuntimeController.currentState()) }

                DisposableEffect(Unit) {
                    val listener: (AgentUiState) -> Unit = { updated ->
                        if (Looper.myLooper() == Looper.getMainLooper()) {
                            uiState = updated
                        } else {
                            mainHandler.post { uiState = updated }
                        }
                    }
                    AgentRuntimeController.addStateListener(listener)
                    onDispose {
                        AgentRuntimeController.removeStateListener(listener)
                    }
                }

                AgentDashboardScreen(
                    state = uiState,
                    onApiBaseUrlChange = AgentRuntimeController::updateApiBaseUrl,
                    onPairingCodeChange = AgentRuntimeController::updatePairingCode,
                    onPrinterNameChange = AgentRuntimeController::updatePrinterName,
                    onPaperWidthSelect = AgentRuntimeController::updatePaperWidth,
                    onTransportModeSelect = { mode ->
                        if (mode == TransportMode.BLUETOOTH_SPP) {
                            requestMissingRuntimePermissions(startServiceAfter = false)
                        }
                        AgentRuntimeController.updateTransportMode(mode)
                    },
                    onBluetoothMacChange = AgentRuntimeController::updateBluetoothMac,
                    onPairAgentClick = AgentRuntimeController::pairAgent,
                    onToggleServiceClick = {
                        if (uiState.isServiceRunning) {
                            PrintAgentForegroundService.stopService(applicationContext)
                        } else {
                            startRelayServiceWithPermissions()
                        }
                    },
                    onTestPrintClick = AgentRuntimeController::triggerTestPrint,
                    onFlushQueueClick = AgentRuntimeController::flushPendingQueue,
                    onClearAckedClick = AgentRuntimeController::clearAckedJobs,
                    onRetryErrorClick = {
                        AgentRuntimeController.dismissError()
                        if (uiState.isServiceRunning) {
                            AgentRuntimeController.connectRelay()
                            AgentRuntimeController.flushPendingQueue()
                        } else {
                            AgentRuntimeController.pairAgent()
                        }
                    },
                    onDismissErrorClick = AgentRuntimeController::dismissError
                )
            }
        }
    }

    private fun startRelayServiceWithPermissions() {
        if (requestMissingRuntimePermissions(startServiceAfter = true)) {
            PrintAgentForegroundService.startService(applicationContext)
        }
    }

    /**
     * Returns `true` if all needed permissions are already granted, or `false` after launching
     * the runtime permission prompt.
     */
    private fun requestMissingRuntimePermissions(startServiceAfter: Boolean): Boolean {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED
            ) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN)
                != PackageManager.PERMISSION_GRANTED
            ) {
                needed.add(Manifest.permission.BLUETOOTH_SCAN)
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (needed.isEmpty()) return true
        pendingServiceStart = startServiceAfter
        permissionLauncher.launch(needed.toTypedArray())
        return false
    }
}
