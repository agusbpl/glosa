"""Bounded declarative diagrams and sampled plots; courses contain no executable code."""
import math


def validate(visuals, block_ids):
    def text(value, limit=200):
        return isinstance(value, str) and bool(value.strip()) and len(value) <= limit

    def number(value):
        return type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e12

    if not isinstance(visuals, list) or len(visuals) > 4:
        raise ValueError('visuals debe contener hasta cuatro representaciones.')
    ids = set()
    for visual in visuals:
        if not isinstance(visual, dict) or not text(visual.get('id'), 100) or visual['id'] in ids:
            raise ValueError('Visual inválido o duplicado.')
        ids.add(visual['id'])
        if not text(visual.get('title')) or not text(visual.get('caption'), 3000):
            raise ValueError('El visual necesita título y explicación textual.')
        if 'blockId' in visual and (not text(visual['blockId'], 100) or visual['blockId'] not in block_ids):
            raise ValueError('El visual debe señalar un bloque existente.')
        if visual.get('kind') == 'flow':
            nodes, edges = visual.get('nodes'), visual.get('edges')
            if not isinstance(nodes, list) or not 2 <= len(nodes) <= 12 or not isinstance(edges, list) or not 1 <= len(edges) <= 24:
                raise ValueError('El diagrama requiere 2–12 nodos y 1–24 conexiones.')
            node_ids, positions = set(), set()
            for node in nodes:
                if not isinstance(node, dict) or not text(node.get('id'), 100) or node['id'] in node_ids or not text(node.get('label'), 60) or not text(node.get('detail'), 2000):
                    raise ValueError('Nodo inválido o duplicado.')
                col, row = node.get('col'), node.get('row')
                if type(col) is not int or type(row) is not int or not 0 <= col <= 2 or not 0 <= row <= 5 or (col, row) in positions:
                    raise ValueError('Posición de nodo inválida o superpuesta.')
                node_ids.add(node['id']); positions.add((col, row))
            for edge in edges:
                if not isinstance(edge, dict) or not text(edge.get('from'), 100) or not text(edge.get('to'), 100) or edge['from'] not in node_ids or edge['to'] not in node_ids or edge['from'] == edge['to'] or not text(edge.get('label'), 100):
                    raise ValueError('Conexión inválida: indicar origen, destino y relación.')
        elif visual.get('kind') == 'plot':
            if not text(visual.get('xLabel')) or not text(visual.get('yLabel')):
                raise ValueError('El gráfico requiere ejes con magnitud y unidades.')
            series = visual.get('series')
            if not isinstance(series, list) or not 1 <= len(series) <= 3:
                raise ValueError('El gráfico requiere 1–3 series.')
            for item in series:
                if not isinstance(item, dict) or not text(item.get('label')) or not isinstance(item.get('points'), list) or not 2 <= len(item['points']) <= 200:
                    raise ValueError('Serie inválida o demasiado extensa.')
                points = item['points']
                if not all(isinstance(p, list) and len(p) == 2 and all(number(v) for v in p) for p in points):
                    raise ValueError('Los puntos deben ser pares numéricos finitos.')
                if any(a[0] >= b[0] for a, b in zip(points, points[1:])):
                    raise ValueError('Los puntos deben aumentar estrictamente en x.')
        else:
            raise ValueError('Tipo de visual no soportado: usar flow o plot.')
