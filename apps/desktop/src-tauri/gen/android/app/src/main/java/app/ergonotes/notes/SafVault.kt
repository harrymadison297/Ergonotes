package app.ergonotes.notes

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/**
 * The vault folder the person picked with the system's folder chooser (Storage Access Framework), as paths
 * relative to it. Every call answers with plain strings so it can sit behind a WebView JavascriptInterface.
 */
class SafVault(ctx: Context) {
  private val prefs = ctx.getSharedPreferences("ergonotes", Context.MODE_PRIVATE)
  private val resolver = ctx.contentResolver
  private var tree: Uri? = prefs.getString("tree", null)?.let { Uri.parse(it) }

  private data class Doc(val id: String, val dir: Boolean, val size: Long, val mtime: Long)
  private val cache = HashMap<String, Doc>()

  fun root(): String = tree?.toString() ?: ""

  fun setTree(u: Uri) {
    tree = u
    prefs.edit().putString("tree", u.toString()).apply()
    synchronized(cache) { cache.clear() }
  }

  private fun rootDoc(): Doc? = tree?.let { Doc(DocumentsContract.getTreeDocumentId(it), true, 0, 0) }
  private fun docUri(id: String): Uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
  private fun parentOf(p: String): String = p.substringBeforeLast('/', "")
  private fun nameOf(p: String): String = p.substringAfterLast('/')
  private fun join(dir: String, name: String): String = if (dir.isEmpty()) name else "$dir/$name"

  /** the children of a directory, one query; remembered so a path can be turned into a document */
  private fun children(dirPath: String, dir: Doc): List<Pair<String, Doc>> {
    val out = ArrayList<Pair<String, Doc>>()
    val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dir.id)
    val cols = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED)
    resolver.query(uri, cols, null, null, null)?.use { c ->
      while (c.moveToNext()) {
        val name = c.getString(1) ?: continue
        val isDir = c.getString(2) == Document.MIME_TYPE_DIR
        out.add(name to Doc(c.getString(0), isDir, if (c.isNull(3)) 0 else c.getLong(3), if (c.isNull(4)) 0 else c.getLong(4)))
      }
    }
    synchronized(cache) {
      val pre = if (dirPath.isEmpty()) "" else "$dirPath/"
      cache.keys.removeAll { it.startsWith(pre) && !it.substring(pre.length).contains('/') }
      for ((n, d) in out) cache[pre + n] = d
    }
    return out
  }

  private fun resolve(path: String): Doc? {
    if (path.isEmpty()) return rootDoc()
    synchronized(cache) { cache[path]?.let { return it } }
    val parent = resolve(parentOf(path)) ?: return null
    if (!parent.dir) return null
    children(parentOf(path), parent)
    return synchronized(cache) { cache[path] }
  }

  fun list(dir: String): String {
    val d = resolve(dir) ?: return "[]"
    val a = JSONArray()
    for ((n, c) in children(dir, d)) {
      a.put(JSONObject().put("name", n).put("kind", if (c.dir) "dir" else "file").put("size", if (c.dir) 0 else c.size).put("mtime", if (c.dir) 0 else c.mtime))
    }
    return a.toString()
  }

  fun stat(path: String): String? {
    val d = resolve(path) ?: return null
    return JSONObject().put("kind", if (d.dir) "dir" else "file").put("size", if (d.dir) 0 else d.size).put("mtime", if (d.dir) 0 else d.mtime).toString()
  }

  /** base64 of the file, or null when it is not there */
  fun read(path: String): String? {
    val d = resolve(path) ?: return null
    if (d.dir) return null
    return try {
      resolver.openInputStream(docUri(d.id))?.use { Base64.encodeToString(it.readBytes(), Base64.NO_WRAP) }
    } catch (e: Exception) { null }
  }

  private fun mkdirs(path: String): Doc? {
    if (path.isEmpty()) return rootDoc()
    resolve(path)?.let { return if (it.dir) it else null }
    val parent = mkdirs(parentOf(path)) ?: return null
    val made = DocumentsContract.createDocument(resolver, docUri(parent.id), Document.MIME_TYPE_DIR, nameOf(path)) ?: return null
    val doc = Doc(DocumentsContract.getDocumentId(made), true, 0, 0)
    synchronized(cache) { cache[path] = doc }
    return doc
  }

  fun mkdir(path: String): String {
    return try { if (mkdirs(path) != null) "" else "Could not create the folder" } catch (e: Exception) { e.message ?: "mkdir failed" }
  }

  /** "" on success, otherwise the reason */
  fun write(path: String, b64: String): String {
    return try {
      val bytes = Base64.decode(b64, Base64.DEFAULT)
      val existing = resolve(path)
      val uri: Uri
      if (existing != null && !existing.dir) uri = docUri(existing.id)
      else {
        val parent = mkdirs(parentOf(path)) ?: return "Could not create the folder"
        // one neutral type for everything, so no provider appends an extension of its own
        uri = DocumentsContract.createDocument(resolver, docUri(parent.id), "application/octet-stream", nameOf(path)) ?: return "Could not create the file"
      }
      resolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } ?: return "Could not open the file for writing"
      synchronized(cache) { cache[path] = Doc(DocumentsContract.getDocumentId(uri), false, bytes.size.toLong(), System.currentTimeMillis()) }
      ""
    } catch (e: Exception) { e.message ?: "write failed" }
  }

  fun remove(path: String): String {
    return try {
      val d = resolve(path) ?: return ""
      DocumentsContract.deleteDocument(resolver, docUri(d.id))
      synchronized(cache) { cache.keys.removeAll { it == path || it.startsWith("$path/") } }
      ""
    } catch (e: Exception) { e.message ?: "remove failed" }
  }

  fun rename(from: String, to: String): String {
    return try {
      val src = resolve(from) ?: return "Not found"
      val srcUri = docUri(src.id)
      val sameDir = parentOf(from) == parentOf(to)
      var cur = srcUri
      if (!sameDir) {
        val dst = mkdirs(parentOf(to)) ?: return "Could not create the folder"
        val srcParent = resolve(parentOf(from)) ?: return "Not found"
        cur = DocumentsContract.moveDocument(resolver, srcUri, docUri(srcParent.id), docUri(dst.id)) ?: return "The folder cannot be moved here"
      }
      if (nameOf(from) != nameOf(to)) cur = DocumentsContract.renameDocument(resolver, cur, nameOf(to)) ?: return "Could not rename"
      synchronized(cache) {
        cache.keys.removeAll { it == from || it.startsWith("$from/") }
        cache[to] = Doc(DocumentsContract.getDocumentId(cur), src.dir, src.size, src.mtime)
      }
      ""
    } catch (e: Exception) { e.message ?: "rename failed" }
  }
}
