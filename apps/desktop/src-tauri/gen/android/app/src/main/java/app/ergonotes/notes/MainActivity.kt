package app.ergonotes.notes

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : TauriActivity() {
  // Text shared to the app from another app; the web UI picks it up through ErgoShare.take() and files it as a Capture.
  private var pending: String? = null
  private var web: WebView? = null
  private lateinit var vault: SafVault

  // the vault folder: chosen with the system's folder chooser, kept with a persistable permission
  private val pickFolder = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
    if (uri != null) {
      contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      vault.setTree(uri)
    }
    web?.post { web?.evaluateJavascript("window.dispatchEvent(new CustomEvent('ergo-vault-picked', { detail: { ok: ${uri != null} } }))", null) }
  }

  // a file the person asked to keep (an export): written where the system's "save as" chooser says
  private var saving: ByteArray? = null
  private val createDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri: Uri? ->
    var ok = false
    val data = saving
    saving = null
    if (uri != null && data != null) {
      ok = try { contentResolver.openOutputStream(uri)?.use { it.write(data) } != null } catch (e: Exception) { false }
    }
    web?.post { web?.evaluateJavascript("window.dispatchEvent(new CustomEvent('ergo-file-saved', { detail: { ok: $ok, cancelled: ${uri == null} } }))", null) }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    vault = SafVault(this)
    super.onCreate(savedInstanceState)
    remember(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    remember(intent)
    web?.post { web?.evaluateJavascript("window.dispatchEvent(new Event('ergo-share'))", null) }
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun take(): String {
        val t = pending ?: ""
        pending = null
        return t
      }
    }, "ErgoShare")
    webView.addJavascriptInterface(object {
      @JavascriptInterface fun root(): String = vault.root()
      // the app's own folder on shared storage: reachable from a file manager or a USB cable, no permission needed
      @JavascriptInterface fun defaultDir(): String = (getExternalFilesDir(null) ?: filesDir).absolutePath + "/Ergonotes"
      @JavascriptInterface fun pick() { runOnUiThread { pickFolder.launch(null) } }
      @JavascriptInterface fun save(name: String, b64: String) { saving = Base64.decode(b64, Base64.DEFAULT); runOnUiThread { createDocument.launch(name) } }
      @JavascriptInterface fun list(dir: String): String = vault.list(dir)
      @JavascriptInterface fun stat(path: String): String? = vault.stat(path)
      @JavascriptInterface fun read(path: String): String? = vault.read(path)
      @JavascriptInterface fun write(path: String, b64: String): String = vault.write(path, b64)
      @JavascriptInterface fun mkdir(path: String): String = vault.mkdir(path)
      @JavascriptInterface fun remove(path: String): String = vault.remove(path)
      @JavascriptInterface fun rename(from: String, to: String): String = vault.rename(from, to)
    }, "ErgoVault")
  }

  private fun remember(i: Intent?) {
    if (i?.action != Intent.ACTION_SEND || i.type?.startsWith("text/") != true) return
    val text = i.getStringExtra(Intent.EXTRA_TEXT) ?: return
    val subject = i.getStringExtra(Intent.EXTRA_SUBJECT)
    pending = if (subject.isNullOrBlank()) text else "$subject\n\n$text"
  }
}
