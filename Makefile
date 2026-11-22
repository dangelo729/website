# the site and its text editor, run here.
#
#   make start    serves the repo at http://localhost:8000
#   make edit     opens the text editor, which writes js/text.js and js/icons.js

.PHONY: start edit

start:
	python3 -m http.server 8000

edit:
	python3 tools/text/serve.py
