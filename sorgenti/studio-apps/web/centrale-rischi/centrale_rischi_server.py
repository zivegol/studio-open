from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import cgi
import io
import json
import sys

from pypdf import PdfReader


class CentraleRischiHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if not self.path.endswith("/api/extract-pdf"):
            self.send_error(404)
            return

        content_type = self.headers.get("content-type", "")
        if "multipart/form-data" not in content_type:
            self.send_error(400, "multipart/form-data richiesto")
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )
        upload = form["file"] if "file" in form else None
        if upload is None or not getattr(upload, "file", None):
            self.send_error(400, "file mancante")
            return

        try:
            data = upload.file.read()
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
            payload = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
        except Exception as exc:
            self.send_error(500, f"estrazione PDF non riuscita: {exc}")
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8788
    server = ThreadingHTTPServer(("127.0.0.1", port), CentraleRischiHandler)
    print(f"Centrale Rischi server: http://127.0.0.1:{port}/centrale_rischi_storica.html")
    server.serve_forever()


if __name__ == "__main__":
    main()
