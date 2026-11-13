package com.printerapi.agent.queue

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Print job lifecycle states persisted in the local Room-compatible offline queue.
 */
enum class JobStatus {
    QUEUED,
    PRINTING,
    ACK,
    FAILED
}

/**
 * Room-compatible entity representing a thermal print job queued on the Android agent.
 */
data class PrintJobEntity(
    val jobId: String,
    val printerId: String,
    val payloadType: String,
    val payloadJson: String,
    val status: JobStatus = JobStatus.QUEUED,
    val retryCount: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val ackedAt: Long? = null,
    val errorMessage: String? = null
)

enum class EnqueueResult {
    ENQUEUED,
    ALREADY_PENDING,
    ALREADY_ACKED
}

/**
 * Room-style DAO contract for offline print job persistence.
 */
interface PrintJobDao {
    fun getByJobId(jobId: String): PrintJobEntity?
    fun getAll(): List<PrintJobEntity>
    fun getPendingJobs(maxRetries: Int = 3): List<PrintJobEntity>
    fun insert(job: PrintJobEntity)
    fun update(job: PrintJobEntity)
    fun deleteAcked(): Int
    fun deleteAll()
}

/**
 * Pure-JVM in-memory [PrintJobDao] used by JUnit4 tests (`./gradlew testDebugUnitTest`)
 * and headless SDK runners without requiring Robolectric or SQLite native libs.
 */
class InMemoryPrintJobDao : PrintJobDao {
    private val jobs = linkedMapOf<String, PrintJobEntity>()

    @Synchronized
    override fun getByJobId(jobId: String): PrintJobEntity? = jobs[jobId]

    @Synchronized
    override fun getAll(): List<PrintJobEntity> =
        jobs.values.sortedByDescending { it.createdAt }

    @Synchronized
    override fun getPendingJobs(maxRetries: Int): List<PrintJobEntity> =
        jobs.values
            .filter {
                it.status == JobStatus.QUEUED ||
                    it.status == JobStatus.PRINTING ||
                    (it.status == JobStatus.FAILED && it.retryCount < maxRetries)
            }
            .sortedBy { it.createdAt }

    @Synchronized
    override fun insert(job: PrintJobEntity) {
        jobs[job.jobId] = job
    }

    @Synchronized
    override fun update(job: PrintJobEntity) {
        jobs[job.jobId] = job
    }

    @Synchronized
    override fun deleteAcked(): Int {
        val ackedKeys = jobs.values.filter { it.status == JobStatus.ACK }.map { it.jobId }
        ackedKeys.forEach { jobs.remove(it) }
        return ackedKeys.size
    }

    @Synchronized
    override fun deleteAll() {
        jobs.clear()
    }
}

/**
 * SQLite-backed database matching the Room schema for persistent offline job storage on Android.
 */
class OfflineDatabase(
    context: Context,
    dbName: String = DATABASE_NAME
) : SQLiteOpenHelper(context.applicationContext, dbName, null, DATABASE_VERSION) {

    companion object {
        const val DATABASE_NAME = "print_agent_offline.db"
        const val DATABASE_VERSION = 1
        const val TABLE_PRINT_JOBS = "print_jobs"

        const val COL_JOB_ID = "job_id"
        const val COL_PRINTER_ID = "printer_id"
        const val COL_PAYLOAD_TYPE = "payload_type"
        const val COL_PAYLOAD_JSON = "payload_json"
        const val COL_STATUS = "status"
        const val COL_RETRY_COUNT = "retry_count"
        const val COL_CREATED_AT = "created_at"
        const val COL_ACKED_AT = "acked_at"
        const val COL_ERROR_MESSAGE = "error_message"
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE_PRINT_JOBS (
                $COL_JOB_ID TEXT PRIMARY KEY NOT NULL,
                $COL_PRINTER_ID TEXT NOT NULL,
                $COL_PAYLOAD_TYPE TEXT NOT NULL,
                $COL_PAYLOAD_JSON TEXT NOT NULL,
                $COL_STATUS TEXT NOT NULL,
                $COL_RETRY_COUNT INTEGER NOT NULL DEFAULT 0,
                $COL_CREATED_AT INTEGER NOT NULL,
                $COL_ACKED_AT INTEGER,
                $COL_ERROR_MESSAGE TEXT
            )
            """.trimIndent()
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS idx_offline_jobs_status ON $TABLE_PRINT_JOBS($COL_STATUS, $COL_CREATED_AT)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_PRINT_JOBS")
        onCreate(db)
    }
}

/**
 * Android SQLite implementation of [PrintJobDao] backed by [OfflineDatabase].
 */
class SqlitePrintJobDao(
    private val dbHelper: OfflineDatabase
) : PrintJobDao {

    override fun getByJobId(jobId: String): PrintJobEntity? {
        val db = dbHelper.readableDatabase
        db.query(
            OfflineDatabase.TABLE_PRINT_JOBS,
            null,
            "${OfflineDatabase.COL_JOB_ID} = ?",
            arrayOf(jobId),
            null,
            null,
            null,
            "1"
        ).use { cursor ->
            return if (cursor.moveToFirst()) cursorToEntity(cursor) else null
        }
    }

    override fun getAll(): List<PrintJobEntity> {
        val db = dbHelper.readableDatabase
        val results = mutableListOf<PrintJobEntity>()
        db.query(
            OfflineDatabase.TABLE_PRINT_JOBS,
            null,
            null,
            null,
            null,
            null,
            "${OfflineDatabase.COL_CREATED_AT} DESC"
        ).use { cursor ->
            while (cursor.moveToNext()) {
                results.add(cursorToEntity(cursor))
            }
        }
        return results
    }

    override fun getPendingJobs(maxRetries: Int): List<PrintJobEntity> {
        val db = dbHelper.readableDatabase
        val results = mutableListOf<PrintJobEntity>()
        val selection =
            "${OfflineDatabase.COL_STATUS} = ? OR ${OfflineDatabase.COL_STATUS} = ? OR " +
                "(${OfflineDatabase.COL_STATUS} = ? AND ${OfflineDatabase.COL_RETRY_COUNT} < ?)"
        val args = arrayOf(
            JobStatus.QUEUED.name,
            JobStatus.PRINTING.name,
            JobStatus.FAILED.name,
            maxRetries.toString()
        )
        db.query(
            OfflineDatabase.TABLE_PRINT_JOBS,
            null,
            selection,
            args,
            null,
            null,
            "${OfflineDatabase.COL_CREATED_AT} ASC"
        ).use { cursor ->
            while (cursor.moveToNext()) {
                results.add(cursorToEntity(cursor))
            }
        }
        return results
    }

    override fun insert(job: PrintJobEntity) {
        val db = dbHelper.writableDatabase
        db.insertWithOnConflict(
            OfflineDatabase.TABLE_PRINT_JOBS,
            null,
            entityToValues(job),
            SQLiteDatabase.CONFLICT_REPLACE
        )
    }

    override fun update(job: PrintJobEntity) {
        val db = dbHelper.writableDatabase
        val updated = db.update(
            OfflineDatabase.TABLE_PRINT_JOBS,
            entityToValues(job),
            "${OfflineDatabase.COL_JOB_ID} = ?",
            arrayOf(job.jobId)
        )
        if (updated == 0) {
            insert(job)
        }
    }

    override fun deleteAcked(): Int {
        val db = dbHelper.writableDatabase
        return db.delete(
            OfflineDatabase.TABLE_PRINT_JOBS,
            "${OfflineDatabase.COL_STATUS} = ?",
            arrayOf(JobStatus.ACK.name)
        )
    }

    override fun deleteAll() {
        val db = dbHelper.writableDatabase
        db.delete(OfflineDatabase.TABLE_PRINT_JOBS, null, null)
    }

    private fun entityToValues(job: PrintJobEntity): ContentValues = ContentValues().apply {
        put(OfflineDatabase.COL_JOB_ID, job.jobId)
        put(OfflineDatabase.COL_PRINTER_ID, job.printerId)
        put(OfflineDatabase.COL_PAYLOAD_TYPE, job.payloadType)
        put(OfflineDatabase.COL_PAYLOAD_JSON, job.payloadJson)
        put(OfflineDatabase.COL_STATUS, job.status.name)
        put(OfflineDatabase.COL_RETRY_COUNT, job.retryCount)
        put(OfflineDatabase.COL_CREATED_AT, job.createdAt)
        if (job.ackedAt != null) {
            put(OfflineDatabase.COL_ACKED_AT, job.ackedAt)
        } else {
            putNull(OfflineDatabase.COL_ACKED_AT)
        }
        if (job.errorMessage != null) {
            put(OfflineDatabase.COL_ERROR_MESSAGE, job.errorMessage)
        } else {
            putNull(OfflineDatabase.COL_ERROR_MESSAGE)
        }
    }

    private fun cursorToEntity(cursor: android.database.Cursor): PrintJobEntity {
        val ackedIdx = cursor.getColumnIndexOrThrow(OfflineDatabase.COL_ACKED_AT)
        val errIdx = cursor.getColumnIndexOrThrow(OfflineDatabase.COL_ERROR_MESSAGE)
        val statusName = cursor.getString(cursor.getColumnIndexOrThrow(OfflineDatabase.COL_STATUS))
        val parsedStatus = runCatching { JobStatus.valueOf(statusName) }.getOrDefault(JobStatus.QUEUED)
        return PrintJobEntity(
            jobId = cursor.getString(cursor.getColumnIndexOrThrow(OfflineDatabase.COL_JOB_ID)),
            printerId = cursor.getString(cursor.getColumnIndexOrThrow(OfflineDatabase.COL_PRINTER_ID)),
            payloadType = cursor.getString(cursor.getColumnIndexOrThrow(OfflineDatabase.COL_PAYLOAD_TYPE)),
            payloadJson = cursor.getString(cursor.getColumnIndexOrThrow(OfflineDatabase.COL_PAYLOAD_JSON)),
            status = parsedStatus,
            retryCount = cursor.getInt(cursor.getColumnIndexOrThrow(OfflineDatabase.COL_RETRY_COUNT)),
            createdAt = cursor.getLong(cursor.getColumnIndexOrThrow(OfflineDatabase.COL_CREATED_AT)),
            ackedAt = if (cursor.isNull(ackedIdx)) null else cursor.getLong(ackedIdx),
            errorMessage = if (cursor.isNull(errIdx)) null else cursor.getString(errIdx)
        )
    }
}

/**
 * Coordinates idempotent job deduplication, `QUEUED -> PRINTING -> ACK / FAILED` state
 * transitions, and ordered replay of pending offline jobs upon reconnect.
 */
class OfflineJobQueueRepository(
    private val dao: PrintJobDao,
    private val clock: () -> Long = { System.currentTimeMillis() }
) {
    private val lock = Any()
    private val listeners = CopyOnWriteArrayList<(List<PrintJobEntity>) -> Unit>()

    fun enqueueIfAbsent(
        jobId: String,
        printerId: String,
        payloadType: String,
        payloadJson: String
    ): EnqueueResult {
        val result: EnqueueResult
        val snapshot: List<PrintJobEntity>?
        synchronized(lock) {
            val existing = dao.getByJobId(jobId)
            when {
                existing != null && existing.status == JobStatus.ACK -> {
                    result = EnqueueResult.ALREADY_ACKED
                    snapshot = null
                }
                existing != null && (existing.status == JobStatus.QUEUED || existing.status == JobStatus.PRINTING) -> {
                    result = EnqueueResult.ALREADY_PENDING
                    snapshot = null
                }
                existing != null && existing.status == JobStatus.FAILED -> {
                    dao.update(
                        existing.copy(
                            status = JobStatus.QUEUED,
                            errorMessage = null
                        )
                    )
                    result = EnqueueResult.ENQUEUED
                    snapshot = dao.getAll()
                }
                else -> {
                    dao.insert(
                        PrintJobEntity(
                            jobId = jobId,
                            printerId = printerId,
                            payloadType = payloadType,
                            payloadJson = payloadJson,
                            status = JobStatus.QUEUED,
                            retryCount = 0,
                            createdAt = clock(),
                            ackedAt = null,
                            errorMessage = null
                        )
                    )
                    result = EnqueueResult.ENQUEUED
                    snapshot = dao.getAll()
                }
            }
        }
        snapshot?.let(::notifyListeners)
        return result
    }

    fun markPrinting(jobId: String): PrintJobEntity? {
        val updated: PrintJobEntity?
        val snapshot: List<PrintJobEntity>?
        synchronized(lock) {
            val existing = dao.getByJobId(jobId) ?: return null
            if (existing.status == JobStatus.ACK) {
                return existing
            }
            updated = existing.copy(
                status = JobStatus.PRINTING,
                errorMessage = null
            )
            dao.update(updated)
            snapshot = dao.getAll()
        }
        snapshot?.let(::notifyListeners)
        return updated
    }

    fun markAck(jobId: String, ackedAtMillis: Long = clock()): PrintJobEntity? {
        val updated: PrintJobEntity?
        val snapshot: List<PrintJobEntity>?
        synchronized(lock) {
            val existing = dao.getByJobId(jobId) ?: return null
            updated = existing.copy(
                status = JobStatus.ACK,
                ackedAt = ackedAtMillis,
                errorMessage = null
            )
            dao.update(updated)
            snapshot = dao.getAll()
        }
        snapshot?.let(::notifyListeners)
        return updated
    }

    fun markFailed(jobId: String, errorMessage: String?): PrintJobEntity? {
        val updated: PrintJobEntity?
        val snapshot: List<PrintJobEntity>?
        synchronized(lock) {
            val existing = dao.getByJobId(jobId) ?: return null
            if (existing.status == JobStatus.ACK) {
                return existing
            }
            updated = existing.copy(
                status = JobStatus.FAILED,
                retryCount = existing.retryCount + 1,
                errorMessage = errorMessage
            )
            dao.update(updated)
            snapshot = dao.getAll()
        }
        snapshot?.let(::notifyListeners)
        return updated
    }

    fun pendingJobsForReplay(maxRetries: Int = 3): List<PrintJobEntity> = synchronized(lock) {
        dao.getPendingJobs(maxRetries)
    }

    fun getJob(jobId: String): PrintJobEntity? = synchronized(lock) {
        dao.getByJobId(jobId)
    }

    fun allJobs(): List<PrintJobEntity> = synchronized(lock) {
        dao.getAll()
    }

    fun clearAcked(): Int {
        val removed: Int
        val snapshot: List<PrintJobEntity>
        synchronized(lock) {
            removed = dao.deleteAcked()
            snapshot = dao.getAll()
        }
        if (removed > 0) {
            notifyListeners(snapshot)
        }
        return removed
    }

    fun clearAll() {
        synchronized(lock) {
            dao.deleteAll()
        }
        notifyListeners(emptyList())
    }

    fun addListener(listener: (List<PrintJobEntity>) -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: (List<PrintJobEntity>) -> Unit) {
        listeners.remove(listener)
    }

    private fun notifyListeners(snapshot: List<PrintJobEntity>) {
        listeners.forEach { it(snapshot) }
    }
}
