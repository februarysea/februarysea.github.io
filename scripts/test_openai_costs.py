from datetime import datetime, timezone
import copy
import unittest
from openai_costs import collect_costs, validate_costs

NOW = datetime(2026,11,3,12,tzinfo=timezone.utc)

def response():
    return {'object':'page','has_more':False,'data':[{'object':'bucket',
      'start_time':int(NOW.replace(hour=0).timestamp()), 'end_time':int(NOW.timestamp()),
      'results':[{'object':'organization.costs.result','line_item':'gpt-6-astra, input_tokens',
         'amount':{'currency':'usd','value':'0.123456789'},'project_id':'private'}]}]}

class CostsTests(unittest.TestCase):
    def test_exact_decimal_allowlist_and_repeated_collection(self):
        first=collect_costs(None,'2026-11-03','key',now=NOW,api=lambda *_:response())
        self.assertEqual(first['daily'][0]['items'][0]['usd'],'0.123456789')
        self.assertNotIn('private',str(first))
        self.assertEqual(first,collect_costs(first,'2026-11-03','key',now=NOW,api=lambda *_:response()))
    def test_missing_is_unknown_and_empty_is_reported_zero(self):
        for data in [[],[response()['data'][0]]*2]:
            with self.assertRaises(ValueError):
                collect_costs(None,'2026-11-03','key',now=NOW,api=lambda *_:{**response(),'data':data})
        p=response();p['data'][0]['results']=[]
        self.assertEqual(collect_costs(None,'2026-11-03','key',now=NOW,api=lambda *_:p)['daily'][0]['items'],[])
    def test_currency_and_nonfinite_rejected(self):
        for field,value in [('currency','eur'),('value','NaN'),('value',True)]:
            p=response();p['data'][0]['results'][0]['amount'][field]=value
            with self.assertRaises(ValueError):
                collect_costs(None,'2026-11-03','key',now=NOW,api=lambda *_:p)
    def test_negative_adjustments_and_extra_fields(self):
        p=response();p['data'][0]['results'][0]['amount']['value']='-0.02'
        s=collect_costs(None,'2026-11-03','key',now=NOW,api=lambda *_:p)
        self.assertEqual(s['daily'][0]['items'][0]['usd'],'-0.02')
        s['daily'][0]['items'][0]['projectId']='private'
        with self.assertRaises(ValueError):validate_costs(s)
