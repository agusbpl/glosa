"""Recover student-facing text without treating a damaged response as an assessment."""
import json
import re

INCOMPLETE_REPLY = 'El tutor no devolvió una respuesta final completa. Podés reintentar; tu trabajo sigue guardado.'


def visible_text(raw):
    """Drop explicitly delimited thinking, including unfinished blocks."""
    clean = re.sub(r'<(think|analysis|reasoning)\b[^>]*>.*?</\1\s*>', '', raw, flags=re.I | re.S)
    clean = re.split(r'<(?:think|analysis|reasoning)\b[^>]*>', clean, maxsplit=1, flags=re.I)[0]
    # Some providers omit the opening delimiter but leave its closing tag.
    clean = re.split(r'</(?:think|analysis|reasoning)\s*>', clean, flags=re.I)[-1]
    return clean.strip()


def looks_internal(text):
    return bool(re.match(r'^(?:#{1,6}\s*)?(?:analysis\b|reasoning\b|thinking\b|análisis\s*:|razonamiento\s*:|el estudiante (?:envió|ha enviado|respondió|escribió)|analicemos contra la rúbrica|(?:i|we) (?:need to|must)\b|let.s (?:analyze|think)\b)', text, re.I))


def unpack_reply(raw, *, structured=False):
    clean = visible_text(raw)
    if clean.startswith('```'):
        clean = clean.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    # Recover a final envelope even if the provider prepended commentary. Never
    # display that prefix, or interpret an unfinished envelope as an assessment.
    decoder = json.JSONDecoder()
    for start in re.finditer(r'\{', clean):
        try:
            parsed, _ = decoder.raw_decode(clean[start.start():])
        except ValueError:
            continue
        if isinstance(parsed, dict) and isinstance(parsed.get('reply'), str) and parsed['reply'].strip():
            reply = visible_text(parsed['reply'])
            if not reply or looks_internal(reply):
                return INCOMPLETE_REPLY, None, True
            return reply, {**parsed, 'reply': reply}, False
    # A token limit can cut off the metadata after an otherwise complete reply.
    envelope = re.search(r'\{\s*"reply"\s*:', clean)
    offset = 0 if clean.startswith('{') else envelope.start() if envelope else None
    match = re.search(r'"reply"\s*:\s*', clean[offset:]) if offset is not None else None
    if match:
        tail = clean[offset+match.end():]
        try:
            reply, _ = json.JSONDecoder().raw_decode(tail)
            if isinstance(reply, str) and reply.strip():
                reply = visible_text(reply)
                return (reply if reply and not looks_internal(reply) else INCOMPLETE_REPLY), None, True
        except ValueError:
            pass
        if tail.startswith('"'):
            # Preserve complete characters; trim an unfinished JSON escape at EOF.
            for trim in range(7):
                fragment = tail if trim == 0 else tail[:-trim]
                try:
                    reply = json.loads(fragment + '"')
                    if isinstance(reply, str) and reply.strip():
                        reply = visible_text(reply)
                        return (reply if reply and not looks_internal(reply) else INCOMPLETE_REPLY), None, True
                except ValueError:
                    pass
        return INCOMPLETE_REPLY, None, True
    if clean.startswith(('{', '[')):
        return 'El tutor devolvió un formato que no pude interpretar. Podés reintentar.', None, True
    if structured or not clean or looks_internal(clean):
        return INCOMPLETE_REPLY, None, True
    return clean, None, False


def preview_reply(raw, *, structured=False):
    """Project only a reply string from partial JSON; never stream assessment fields."""
    clean = visible_text(raw)
    envelope = re.search(r'\{\s*"reply"\s*:\s*', clean)
    if envelope:
        tail = clean[envelope.end():]
        for trim in range(7):
            fragment = tail if trim == 0 else tail[:-trim]
            try:
                text, _ = json.JSONDecoder().raw_decode(fragment)
            except ValueError:
                try:
                    text = json.loads(fragment + '"')
                except ValueError:
                    continue
            if isinstance(text, str):
                text = visible_text(text)
                return '' if looks_internal(text) else text
        return ''
    if structured or clean.startswith(('{', '[', '```')) or looks_internal(clean):
        return ''
    return clean
