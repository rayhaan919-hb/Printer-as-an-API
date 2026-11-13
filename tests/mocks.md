# Offline Mock Strategy
- **Android Agent Mock:** Run a local Node WebSocket test client in `tests/mocks/mock_agent.ts` that connects with a test `printer_id`, receives `DISPATCHED` jobs, waits 50ms, and emits `ACK`.
- **Bluetooth Hardware Mock:** Abstract `EscPosTransport` behind an interface in Kotlin (`BluetoothTransport` vs `InMemoryByteSinkTransport`) so `./gradlew testDebugUnitTest` verifies exact `GS v 0` raster byte headers without physical hardware.
