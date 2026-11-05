import copy
import unittest
from import_codex_estimate import normalize


def report():
    return {'daily':[{'date':'2026-11-03','costUSD':1.25,'totalTokens':130,
      'sessionId':'private','models':{'example-model':{'inputTokens':20,'cacheReadTokens':100,
      'outputTokens':10,'reasoningOutputTokens':7,'totalTokens':130,'isFallback':True}}}],
      'totals':{'totalTokens':130,'costUSD':1.25}}

class EstimateTests(unittest.TestCase):
    def test_only_aggregates_export_and_reasoning_not_counted_twice(self):
        result=normalize(report())
        self.assertNotIn('private',str(result))
        self.assertEqual(result['totalTokens'],130)
        self.assertEqual(result['estimatedUsd'],1.25)
        self.assertEqual(result['daily'],[{'date':'2026-11-03','totalTokens':130,'estimatedUsd':1.25}])
        self.assertTrue(result['models'][0]['usesFallback'])
    def test_unreconciled_report_or_missing_prices_rejected(self):
        for key,value in [('totalTokens',131),('costUSD',float('nan'))]:
            data=report();data['daily'][0][key]=value
            with self.assertRaises(ValueError):normalize(data)
