.PHONY: check fix watch

PYTHON := $(if $(wildcard venv/bin/python),venv/bin/python,python3)

check:
	$(PYTHON) scripts/quality.py check

fix:
	$(PYTHON) scripts/quality.py fix

watch:
	$(PYTHON) scripts/quality.py watch
