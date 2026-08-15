package com.flockiq.worker

import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

class FlockIqPdfModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "FlockIqPdf"

  @ReactMethod
  fun exportRecordsPdf(payload: String, promise: Promise) {
    try {
      val json = JSONObject(payload)
      val farmName = json.optString("farmName", "Farm")
      val flockName = json.optString("flockName", "Flock")
      val records = json.optJSONArray("records")
      val document = PdfDocument()
      val pageWidth = 595
      val pageHeight = 842
      val paint = Paint(Paint.ANTI_ALIAS_FLAG)
      var pageNumber = 1
      var page = document.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
      var canvas = page.canvas
      var y = drawHeader(canvas, paint, farmName, flockName)

      fun newPage() {
        document.finishPage(page)
        pageNumber += 1
        page = document.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
        canvas = page.canvas
        y = drawHeader(canvas, paint, farmName, flockName)
      }

      paint.typeface = Typeface.DEFAULT_BOLD
      paint.textSize = 12f
      canvas.drawText("Date", 40f, y.toFloat(), paint)
      canvas.drawText("Mortality", 135f, y.toFloat(), paint)
      canvas.drawText("Feed kg", 220f, y.toFloat(), paint)
      canvas.drawText("Eggs", 300f, y.toFloat(), paint)
      canvas.drawText("Sync", 360f, y.toFloat(), paint)
      canvas.drawText("Notes", 430f, y.toFloat(), paint)
      y += 24

      paint.typeface = Typeface.DEFAULT
      paint.textSize = 10f
      if (records != null) {
        for (index in 0 until records.length()) {
          if (y > pageHeight - 50) newPage()
          val record = records.getJSONObject(index)
          canvas.drawText(record.optString("record_date"), 40f, y.toFloat(), paint)
          canvas.drawText(record.optInt("mortality_count").toString(), 135f, y.toFloat(), paint)
          canvas.drawText(record.opt("feed_consumed_kg")?.toString() ?: "0", 220f, y.toFloat(), paint)
          canvas.drawText(record.opt("eggs_collected")?.toString() ?: "0", 300f, y.toFloat(), paint)
          canvas.drawText(record.optString("sync_status"), 360f, y.toFloat(), paint)
          canvas.drawText(record.optString("notes").take(28), 430f, y.toFloat(), paint)
          y += 20
        }
      }

      document.finishPage(page)
      val file = File(reactContext.cacheDir, "iquila-report-${System.currentTimeMillis()}.pdf")
      FileOutputStream(file).use { output -> document.writeTo(output) }
      document.close()

      val uri = FileProvider.getUriForFile(reactContext, "${reactContext.packageName}.fileprovider", file)
      val intent = Intent(Intent.ACTION_SEND).apply {
        type = "application/pdf"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(Intent.createChooser(intent, "Share IQuila PDF report").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(uri.toString())
    } catch (error: Exception) {
      promise.reject("PDF_EXPORT_FAILED", error)
    }
  }

  private fun drawHeader(canvas: Canvas, paint: Paint, farmName: String, flockName: String): Int {
    paint.color = android.graphics.Color.rgb(30, 77, 43)
    canvas.drawRect(0f, 0f, 595f, 86f, paint)
    paint.color = android.graphics.Color.WHITE
    paint.typeface = Typeface.DEFAULT_BOLD
    paint.textSize = 24f
    canvas.drawText("IQuila Farm Report", 40f, 38f, paint)
    paint.typeface = Typeface.DEFAULT
    paint.textSize = 12f
    canvas.drawText("Farm: $farmName", 40f, 60f, paint)
    canvas.drawText("Flock: $flockName", 250f, 60f, paint)
    paint.color = android.graphics.Color.rgb(23, 32, 26)
    return 120
  }
}
