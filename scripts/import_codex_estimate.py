"""Import only aggregate statistics from ccusage 20.0.48; never session content."""
import argparse
from datetime import datetime, timezone, date
import json
from pathlib import Path
import math
import re

from codex_usage import token_count


def normalize(report):
    if not isinstance(report, dict) or not isinstance(report.get('daily'), list) or not report['daily']:
        raise ValueError('Expected a nonempty ccusage daily report.')
    models, dates, daily = {}, [], []
    total_cost, total_tokens = 0, 0
    for row in report['daily']:
        current = row['date']
        if date.fromisoformat(current).isoformat()!=current or (dates and current<=dates[-1]):
            raise ValueError('Expected sorted unique usage dates.')
        dates.append(current)
        cost=row['costUSD']
        if isinstance(cost,bool) or not isinstance(cost,(int,float)) or not math.isfinite(cost) or not 0<=cost<=1e12:
            raise ValueError('Invalid estimated cost.')
        total_cost+=cost
        counted=0
        for name, usage in row['models'].items():
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}',name):
                raise ValueError('Invalid model name.')
            if usage.get('cacheCreationTokens',0)!=0:
                raise ValueError('Unsupported additional cache pricing.')
            fields={k:token_count(usage[k]) for k in ['inputTokens','cacheReadTokens','outputTokens','totalTokens']}
            if fields['inputTokens']+fields['cacheReadTokens']+fields['outputTokens']!=fields['totalTokens']:
                raise ValueError('Inconsistent model totals.')
            target=models.setdefault(name,{'model':name,'inputTokens':0,'cachedInputTokens':0,'outputTokens':0,'totalTokens':0,'usesFallback':False})
            for dest,source in [('inputTokens','inputTokens'),('cachedInputTokens','cacheReadTokens'),('outputTokens','outputTokens'),('totalTokens','totalTokens')]:
                target[dest]=token_count(target[dest]+fields[source])
            target['usesFallback'] |= usage.get('isFallback',False) is True
            counted+=fields['totalTokens']
        if counted!=token_count(row['totalTokens']):
            raise ValueError('Unclassified tokens must not be silently omitted.')
        total_tokens=token_count(total_tokens+counted)
        daily.append({'date':current,'totalTokens':counted,'estimatedUsd':round(cost,6)})
    if total_tokens!=token_count(report['totals']['totalTokens']) or not math.isclose(total_cost,report['totals']['costUSD'],abs_tol=1e-6):
        raise ValueError('Report totals do not reconcile.')
    return {'version':1,'source':'ccusage-local-logs','toolVersion':'20.0.48',
        'generatedAt':datetime.now(timezone.utc).isoformat(),'startDate':dates[0],'throughDate':dates[-1],
        'activeDays':len(dates),'totalTokens':total_tokens,'estimatedUsd':round(total_cost,6),
        'models':sorted(models.values(),key=lambda m:(-m['totalTokens'],m['model'])), 'daily':daily}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    data=normalize(json.loads(args.report.read_text()))
    args.output.write_text(json.dumps(data,indent=2,allow_nan=False)+'\n')
    print('Imported aggregate local estimate:',len(data['models']),'models;',data['activeDays'],'active days.')


if __name__=='__main__':main()
