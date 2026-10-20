"""Title identity within a pliego; original spelling remains untouched."""
import unicodedata


def key(title):
    return ' '.join(unicodedata.normalize('NFC', title or '').split()).casefold()
