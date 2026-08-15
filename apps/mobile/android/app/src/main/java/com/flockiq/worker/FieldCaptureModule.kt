package com.flockiq.worker

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Typeface
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import androidx.core.app.ActivityCompat
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class FieldCaptureModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var promise: Promise? = null
  private var photoFile: File? = null
  private var photoUri: Uri? = null
  private var evidenceContext: EvidenceContext? = null
  private val executor = Executors.newSingleThreadExecutor()

  init {
    reactContext.addActivityEventListener(this)
    val interruptedPath = capturePreferences().getString(PENDING_CAPTURE_PATH, null)
    if (interruptedPath != null) runCatching { validatedEvidenceFile(interruptedPath).delete() }
    capturePreferences().edit().remove(PENDING_CAPTURE_PATH).apply()
  }

  override fun getName(): String = "FieldCapture"

  @ReactMethod
  fun capturePhoto(context: com.facebook.react.bridge.ReadableMap, promise: Promise) {
    val activity = currentActivity ?: run {
      promise.reject("NO_ACTIVITY", "Camera requires an active screen")
      return
    }
    if (this.promise != null) {
      promise.reject("CAPTURE_IN_PROGRESS", "Another photo capture is already in progress")
      return
    }

    try {
      val evidenceDir = File(reactContext.filesDir, "field-evidence")
      if ((!evidenceDir.exists() && !evidenceDir.mkdirs()) || !evidenceDir.isDirectory) error("Evidence storage is unavailable")
      val file = File(evidenceDir, "evidence-${UUID.randomUUID()}.jpg")
      val uri = FileProvider.getUriForFile(reactContext, "${reactContext.packageName}.fileprovider", file)
      val intent = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
        putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri("IQuila field evidence", uri)
      }
      if (intent.resolveActivity(activity.packageManager) == null) error("No camera application is available")
      this.promise = promise
      this.photoFile = file
      this.photoUri = uri
      this.evidenceContext = EvidenceContext(
        farmName = context.getString("farmName") ?: "Selected farm",
        flockName = context.getString("flockName") ?: "Selected flock",
        operatorLabel = context.getString("operatorLabel") ?: "Operator",
        evidenceId = context.getString("evidenceId") ?: file.nameWithoutExtension
      )
      capturePreferences().edit().putString(PENDING_CAPTURE_PATH, file.absolutePath).apply()
      activity.startActivityForResult(intent, REQUEST_CAMERA)
    } catch (error: Exception) {
      clearCapture(deleteFile = true)
      promise.reject("CAMERA_LAUNCH_FAILED", error)
    }
  }

  @ReactMethod
  fun getLocationStatus(promise: Promise) {
    val activity = currentActivity ?: run {
      promise.reject("NO_ACTIVITY", "Location status requires an active screen")
      return
    }
    try {
      val fine = ActivityCompat.checkSelfPermission(activity, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
      val coarse = ActivityCompat.checkSelfPermission(activity, android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
      val manager = activity.getSystemService(Activity.LOCATION_SERVICE) as LocationManager
      val providerEnabled = runCatching {
        manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
      }.getOrDefault(false)
      val location = if (fine || coarse) latestLocation(activity) else null
      promise.resolve(Arguments.createMap().apply {
        putBoolean("permissionGranted", fine || coarse)
        putBoolean("providerEnabled", providerEnabled)
        putBoolean("fixAvailable", location != null)
        if (location != null) putDouble("accuracyMeters", location.accuracy.toDouble()) else putNull("accuracyMeters")
      })
    } catch (error: Exception) {
      promise.reject("LOCATION_STATUS_FAILED", error)
    }
  }

  @ReactMethod
  fun readFileBase64(path: String, promise: Promise) {
    try {
      val file = validatedEvidenceFile(path)
      if (!file.exists()) error("Evidence file no longer exists")
      if (file.length() > MAX_UPLOAD_BYTES) error("Evidence photo is too large to upload")
      promise.resolve(Base64.encodeToString(file.readBytes(), Base64.NO_WRAP))
    } catch (error: Exception) {
      promise.reject("FILE_READ_FAILED", error)
    }
  }

  @ReactMethod
  fun deleteLocalFile(path: String, promise: Promise) {
    try {
      val file = validatedEvidenceFile(path)
      promise.resolve(!file.exists() || file.delete())
    } catch (error: Exception) {
      promise.reject("FILE_DELETE_FAILED", error)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CAMERA) return
    val pending = promise
    val file = photoFile
    val context = evidenceContext
    if (resultCode != Activity.RESULT_OK || file == null) {
      clearCapture(deleteFile = true)
      pending?.reject("CAPTURE_CANCELLED", "Photo capture was cancelled")
      return
    }
    if (!file.exists() || file.length() == 0L) {
      clearCapture(deleteFile = true)
      pending?.reject("CAPTURE_EMPTY", "The camera did not return a valid photo")
      return
    }
    val grantedUri = photoUri
    promise = null
    photoFile = null
    photoUri = null
    evidenceContext = null
    if (grantedUri != null) activity.revokeUriPermission(grantedUri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    executor.execute {
      try {
        val capturedAt = OffsetDateTime.now()
        val location = bestEffortLocation(activity)
        stampPhoto(file, capturedAt, location, context ?: EvidenceContext("Selected farm", "Selected flock", "Operator", file.nameWithoutExtension))
        capturePreferences().edit().remove(PENDING_CAPTURE_PATH).apply()
        val result = Arguments.createMap().apply {
          putString("uri", Uri.fromFile(file).toString())
          putString("path", file.absolutePath)
          putDouble("sizeBytes", file.length().toDouble())
          putString("deviceCapturedAt", capturedAt.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
          putString("timezone", ZoneId.systemDefault().id)
          putString("locationSource", location.source)
          putString("locationStatus", location.status)
          if (location.location != null) {
            putDouble("latitude", location.location.latitude)
            putDouble("longitude", location.location.longitude)
            putDouble("accuracyMeters", location.location.accuracy.toDouble())
            putString("locationCapturedAt", OffsetDateTime.ofInstant(java.time.Instant.ofEpochMilli(location.location.time), ZoneId.systemDefault()).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
            putDouble("locationAgeSeconds", location.ageSeconds.toDouble())
          } else {
            putNull("latitude")
            putNull("longitude")
            putNull("accuracyMeters")
            putNull("locationCapturedAt")
            putNull("locationAgeSeconds")
          }
        }
        pending?.resolve(result)
      } catch (error: Exception) {
        file.delete()
        capturePreferences().edit().remove(PENDING_CAPTURE_PATH).apply()
        pending?.reject("CAPTURE_PROCESSING_FAILED", error)
      }
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun latestLocation(activity: Activity, maxAgeNanos: Long? = MAX_LOCATION_AGE_NANOS): Location? {
    val fine = ActivityCompat.checkSelfPermission(activity, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    val coarse = ActivityCompat.checkSelfPermission(activity, android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    if (!fine && !coarse) return null
    val manager = activity.getSystemService(Activity.LOCATION_SERVICE) as LocationManager
    return manager.getProviders(true)
      .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
      .filter { location -> maxAgeNanos == null || android.os.SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos <= maxAgeNanos }
      .filter { location -> location.accuracy <= MAX_LOCATION_ACCURACY_METERS }
      .maxByOrNull { it.elapsedRealtimeNanos }
  }

  private fun bestEffortLocation(activity: Activity): LocationStamp {
    val fine = ActivityCompat.checkSelfPermission(activity, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    val coarse = ActivityCompat.checkSelfPermission(activity, android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    if (!fine && !coarse) return LocationStamp(null, "unavailable", "permission_denied", 0)
    val fresh = freshLocation(activity)
    if (fresh != null) return LocationStamp(fresh, "available", "fresh_gps", locationAgeSeconds(fresh))
    val cached = latestLocation(activity, maxAgeNanos = null)
    if (cached != null) return LocationStamp(cached, "approximate_last_known", "last_known", locationAgeSeconds(cached))
    return LocationStamp(null, "unavailable", "none", 0)
  }

  private fun freshLocation(activity: Activity): Location? {
    val fine = ActivityCompat.checkSelfPermission(activity, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    val coarse = ActivityCompat.checkSelfPermission(activity, android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    if (!fine && !coarse) return null
    val manager = activity.getSystemService(Activity.LOCATION_SERVICE) as LocationManager
    val providers = manager.getProviders(true).filter { provider -> fine || provider != LocationManager.GPS_PROVIDER }
    if (providers.isEmpty()) return null
    val latch = CountDownLatch(1)
    var best: Location? = null
    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        if (location.accuracy <= MAX_LOCATION_ACCURACY_METERS && (best == null || location.accuracy < best!!.accuracy)) best = location
        latch.countDown()
      }
      @Deprecated("Deprecated in Android API")
      override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
      override fun onProviderEnabled(provider: String) = Unit
      override fun onProviderDisabled(provider: String) = Unit
    }
    providers.forEach { provider -> runCatching { manager.requestLocationUpdates(provider, 0L, 0f, listener, android.os.Looper.getMainLooper()) } }
    latch.await(FRESH_LOCATION_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    runCatching { manager.removeUpdates(listener) }
    return best?.takeIf { locationAgeSeconds(it) <= 10 }
  }

  private fun locationAgeSeconds(location: Location): Long =
    ((android.os.SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000_000L).coerceAtLeast(0)

  private fun stampPhoto(file: File, capturedAt: OffsetDateTime, location: LocationStamp, context: EvidenceContext) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    var sampleSize = 1
    while (bounds.outWidth / sampleSize > 2048 || bounds.outHeight / sampleSize > 2048) sampleSize *= 2
    val source = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sampleSize })
      ?: error("Camera image could not be decoded")
    val orientation = ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    val matrix = orientationMatrix(orientation)
    val oriented = if (!matrix.isIdentity) Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true) else source
    val bitmap = oriented.copy(Bitmap.Config.ARGB_8888, true) ?: error("Camera image could not be prepared")
    val canvas = Canvas(bitmap)
    val textSize = (bitmap.width * 0.032f).coerceAtLeast(24f)
    val padding = textSize * 0.7f
    val timezone = ZoneId.systemDefault().id
    val locationLine = when (location.source) {
      "fresh_gps" -> location.location?.let { "GPS available ${"%.6f".format(Locale.US, it.latitude)}, ${"%.6f".format(Locale.US, it.longitude)} +/-${it.accuracy.toInt()}m" } ?: "Location unavailable"
      "last_known" -> location.location?.let { "Approximate / last known ${"%.6f".format(Locale.US, it.latitude)}, ${"%.6f".format(Locale.US, it.longitude)} +/-${it.accuracy.toInt()}m" } ?: "Location unavailable"
      else -> "Location unavailable"
    }
    val locationTimeLine = location.location?.let { "Location time: ${OffsetDateTime.ofInstant(java.time.Instant.ofEpochMilli(it.time), ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss XXX"))}" } ?: "Location time: unavailable"
    val lines = listOf(
      "IQuila Field Evidence",
      "Farm: ${context.farmName}",
      "Flock: ${context.flockName}",
      "Operator: ${context.operatorLabel}",
      "Evidence ID: ${context.evidenceId}",
      "Captured: ${capturedAt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss XXX"))} $timezone",
      locationLine,
      locationTimeLine
    )
    val background = Paint().apply { color = Color.argb(175, 10, 25, 15) }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; this.textSize = textSize; typeface = Typeface.DEFAULT_BOLD }
    val boxHeight = padding * 2 + textSize * lines.size * 1.35f
    canvas.drawRect(0f, bitmap.height - boxHeight, bitmap.width.toFloat(), bitmap.height.toFloat(), background)
    lines.forEachIndexed { index, line -> canvas.drawText(line, padding, bitmap.height - boxHeight + padding + textSize * (index + 1) * 1.2f, paint) }
    val output = File(file.parentFile, "${file.name}.tmp")
    try {
      FileOutputStream(output).use {
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 88, it)) error("Camera image could not be saved")
      }
      if (output.length() == 0L || output.length() > MAX_UPLOAD_BYTES) error("Processed photo exceeds the upload limit")
      if (!output.renameTo(file)) {
        output.copyTo(file, overwrite = true)
        output.delete()
      }
      ExifInterface(file.absolutePath).apply {
        setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
        saveAttributes()
      }
    } finally {
      output.delete()
      bitmap.recycle()
      if (oriented !== source) oriented.recycle()
      if (!source.isRecycled) source.recycle()
    }
  }

  private fun orientationMatrix(orientation: Int) = Matrix().apply {
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(-90f); postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
    }
  }

  private fun validatedEvidenceFile(path: String): File {
    val root = File(reactContext.filesDir, "field-evidence").canonicalFile
    val file = File(path).canonicalFile
    if (file.parentFile != root || file.extension.lowercase() != "jpg") error("Invalid evidence file path")
    return file
  }

  private fun clearCapture(deleteFile: Boolean) {
    if (deleteFile) photoFile?.delete()
    photoUri?.let { reactContext.revokeUriPermission(it, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
    promise = null
    photoFile = null
    photoUri = null
    evidenceContext = null
    if (deleteFile) capturePreferences().edit().remove(PENDING_CAPTURE_PATH).apply()
  }

  private fun capturePreferences() = reactContext.getSharedPreferences("iquila_capture", android.content.Context.MODE_PRIVATE)

  override fun invalidate() {
    promise?.reject("MODULE_INVALIDATED", "Photo capture was interrupted")
    clearCapture(deleteFile = false)
    reactContext.removeActivityEventListener(this)
    executor.shutdown()
    super.invalidate()
  }

  companion object {
    private const val REQUEST_CAMERA = 4101
    private const val MAX_UPLOAD_BYTES = 9_500_000L
    private const val MAX_LOCATION_ACCURACY_METERS = 250f
    private const val MAX_LOCATION_AGE_NANOS = 60_000_000_000L
    private const val FRESH_LOCATION_TIMEOUT_MS = 7_000L
    private const val PENDING_CAPTURE_PATH = "pending_capture_path"
  }

  private data class EvidenceContext(val farmName: String, val flockName: String, val operatorLabel: String, val evidenceId: String)
  private data class LocationStamp(val location: Location?, val status: String, val source: String, val ageSeconds: Long)
}
