// Reports and drives the iCloud Drive state of one file, for the backup
// round-trip check: wait until uploaded, evict the local copy, download it
// again from iCloud, then compare bytes. Evicting removes only this Mac's
// local copy; the file stays in iCloud. Prints one JSON object per call.
import Foundation

func fail(_ message: String, _ code: Int32 = 1) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(code)
}

let arguments = CommandLine.arguments
guard arguments.count == 3, ["status", "evict", "download"].contains(arguments[1]) else {
  fail("usage: houseatlas-icloud status|evict|download <path>", 64)
}
let url = URL(fileURLWithPath: arguments[2])

switch arguments[1] {
case "evict":
  do { try FileManager.default.evictUbiquitousItem(at: url) } catch { fail("evict: \(error)") }
case "download":
  do { try FileManager.default.startDownloadingUbiquitousItem(at: url) } catch {
    fail("download: \(error)")
  }
default:
  break
}

let keys: Set<URLResourceKey> = [
  .isUbiquitousItemKey, .ubiquitousItemIsUploadedKey, .ubiquitousItemIsUploadingKey,
  .ubiquitousItemUploadingErrorKey, .ubiquitousItemDownloadingStatusKey,
  .ubiquitousItemDownloadingErrorKey,
]
var fresh = url
fresh.removeAllCachedResourceValues()
let values: URLResourceValues
do { values = try fresh.resourceValues(forKeys: keys) } catch { fail("status: \(error)") }
var report: [String: Any] = [
  "ubiquitous": values.isUbiquitousItem ?? false,
  "uploaded": values.ubiquitousItemIsUploaded ?? false,
  "uploading": values.ubiquitousItemIsUploading ?? false,
  "downloadingStatus": values.ubiquitousItemDownloadingStatus?.rawValue ?? "unknown",
]
if let error = values.ubiquitousItemUploadingError {
  report["uploadingError"] = error.localizedDescription
}
if let error = values.ubiquitousItemDownloadingError {
  report["downloadingError"] = error.localizedDescription
}
let json = try! JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
print(String(data: json, encoding: .utf8)!)
