import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import wms_agent as agent

class WorkerTests(unittest.TestCase):
    def fixture(self,depot='CD ESCOBAR',quantity=5):
        headers=['Depósito','Cod. Art','Artículo','Unidades','Bultos','Cara','Columna','Nivel','Profundidad','Contenedor']
        values=[depot,'001SKU','Articulo',quantity,1,'1A','001','01','1','CONT']
        lines=[[SimpleNamespace(value=value,number_format='General') for value in row] for row in [headers,values,values]]
        return SimpleNamespace(worksheets=[SimpleNamespace(iter_rows=lambda:iter(lines))],close=lambda:None)
    def test_only_production_is_allowed(self):
        agent.production_only(agent.PRODUCTION_URL)
        for value in ['https://wms.grupo-aftermarket.com:4446/SGLWMS_TEST/hinicio.aspx','http://wms.grupo-aftermarket.com:4446/SGLWMS_DISTRIMAR_PROD/hinicio.aspx','https://example.com/SGLWMS_DISTRIMAR_PROD/hinicio.aspx']:
            with self.assertRaises(ValueError):agent.production_only(value)
    def test_position_and_repeated_rows_are_preserved(self):
        with patch('openpyxl.load_workbook',return_value=self.fixture()):rows=agent.parse_stock(Path('test.xlsx'))
        self.assertEqual(len(rows),2);self.assertEqual(rows[0][0],'001SKU');self.assertEqual(rows[0][2],'1A 001 01');self.assertEqual(rows[0][1],5)
    def test_wrong_depot_and_invalid_quantity_are_rejected(self):
        for workbook in [self.fixture('CD WARNES'),self.fixture(quantity='bad'),self.fixture(quantity=None)]:
            with patch('openpyxl.load_workbook',return_value=workbook):
                with self.assertRaises(ValueError):agent.parse_stock(Path('test.xlsx'))
    def test_partial_stock_has_no_full_inventory_minimum(self):
        with patch('openpyxl.load_workbook',return_value=self.fixture(quantity=-1)):rows=agent.parse_stock(Path('test.xlsx'))
        self.assertEqual(rows[0][1],-1);self.assertEqual(len(rows),2)
    def test_failed_download_does_not_publish_a_snapshot(self):
        calls=[]
        backend=SimpleNamespace(call=lambda op,body=None,**kwargs:calls.append(op))
        with patch.object(agent,'download_stock',side_effect=RuntimeError('Sin conexión')):
            agent.run_job(backend,{},dict(id='job'))
        self.assertEqual(calls,['worker-error'])

if __name__=='__main__':unittest.main()
