import copy
import unittest
import learning_visuals


class LearningVisualTests(unittest.TestCase):
    def setUp(self):
        self.flow = {'id': 'flow', 'kind': 'flow', 'title': 'Circuito', 'caption': 'Modelo didáctico',
                     'blockId': 'b', 'nodes': [
                         {'id': 'a', 'label': 'A', 'detail': 'Recibe', 'col': 0, 'row': 0},
                         {'id': 'b', 'label': 'B', 'detail': 'Procesa', 'col': 1, 'row': 0}],
                     'edges': [{'from': 'a', 'to': 'b', 'label': 'Pedido'}]}
        self.plot = {'id': 'plot', 'kind': 'plot', 'title': 'Costo', 'caption': 'Datos ficticios',
                     'xLabel': 'Cantidad (u)', 'yLabel': 'Costo ($)',
                     'series': [{'label': 'Costo total', 'points': [[0, 5], [1, 8]]}]}

    def test_valid_models_and_node_identity(self):
        learning_visuals.validate([self.flow, self.plot], {'b'})
        for change in [lambda v: v['edges'][0].update(to='missing'),
                       lambda v: v['nodes'][1].update(col=0),
                       lambda v: v.update(blockId='missing'),
                       lambda v: v['edges'][0].update(to=[])]:
            visual = copy.deepcopy(self.flow); change(visual)
            with self.assertRaises(ValueError):
                learning_visuals.validate([visual], {'b'})

    def test_rejects_executable_and_invalid_quantitative_models(self):
        for points in [[[1, 1], [0, 2]], [[0, 1], [0, 2]],
                       [[0, 1], [1, float('nan')]], [[0, 1], [True, 2]],
                       [[0, 1], [1, 'alert(1)']]]:
            with self.subTest(points=points):
                visual = copy.deepcopy(self.plot); visual['series'][0]['points'] = points
                with self.assertRaises(ValueError):
                    learning_visuals.validate([visual], set())
        self.plot['kind'] = 'html'
        with self.assertRaises(ValueError):
            learning_visuals.validate([self.plot], set())
