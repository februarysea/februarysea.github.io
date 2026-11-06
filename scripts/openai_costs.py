"""Allowlisted organization cost records, separate from token price estimates."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import re

from openai_usage import RECHECK_DAYS, day, request
from codex_usage import timestamp


def dollars(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError('Invalid cost amount.')
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise ValueError('Invalid cost amount.') from None
    if not result.is_finite() or abs(result) > 10**12:
        raise ValueError('Invalid cost amount.')
    return result


def validate_costs(data):
    if not isinstance(data, dict) or set(data) != {'generatedAt', 'startDate', 'throughDate', 'currency', 'daily'}:
        raise ValueError('Invalid cost snapshot fields.')
    if data['currency'] != 'usd' or not isinstance(data['daily'], list):
        raise ValueError('Invalid cost snapshot.')
    start, through = day(data['startDate']), day(data['throughDate'])
    if not start <= through <= timestamp(data['generatedAt']).astimezone(timezone.utc).date():
        raise ValueError('Invalid cost coverage.')
    expected = start
    for row in data['daily']:
        if not isinstance(row, dict) or set(row) != {'date', 'items'} or day(row['date']) != expected or not isinstance(row['items'], list):
            raise ValueError('Invalid cost day.')
        last = ''
        for item in row['items']:
            if not isinstance(item, dict) or set(item) != {'lineItem', 'usd'}:
                raise ValueError('Invalid cost item fields.')
            name = item['lineItem']
            if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 .,:_()/+-]{0,199}', name) or name <= last:
                raise ValueError('Invalid cost item name.')
            if not isinstance(item['usd'], str):
                raise ValueError('Cost amount must preserve decimal precision.')
            dollars(item['usd'])
            last = name
        expected += timedelta(days=1)
    if expected != through + timedelta(days=1):
        raise ValueError('Missing cost coverage.')
    return data


def collect_costs(previous, start_date, key, *, now=None, api=None):
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    start = day(start_date)
    if previous:
        validate_costs(previous)
        if previous['startDate'] != start_date or timestamp(previous['generatedAt']) > now:
            raise ValueError('Cannot replace cost history.')
    refresh = max(start, day(previous['throughDate']) - timedelta(days=RECHECK_DAYS - 1)) if previous else start
    stop = int(now.timestamp())
    begin = int(datetime.combine(refresh, datetime.min.time(), timezone.utc).timestamp())
    if not key or begin >= stop:
        raise ValueError('Invalid cost query configuration.')
    api = api or (lambda params, key: request(params, key, costs=True))
    params = {'start_time': begin, 'end_time': min(begin + 31*86400, stop),
              'bucket_width': '1d', 'group_by': ['line_item'], 'limit': 31}
    records, cursors = {}, set()
    for _ in range(500):
        page = api(params.copy(), key)
        if not isinstance(page, dict) or page.get('object') != 'page' or not isinstance(page.get('data'), list) or type(page.get('has_more')) is not bool:
            raise ValueError('Invalid costs response.')
        for bucket in page['data']:
            first, last = bucket.get('start_time'), bucket.get('end_time')
            if (bucket.get('object') != 'bucket' or type(first) is not int or type(last) is not int
                    or first % 86400 or not params['start_time'] <= first < params['end_time']
                    or last not in (first+86400, params['end_time']) or last <= first):
                raise ValueError('Invalid cost bucket.')
            date_key = datetime.fromtimestamp(first, timezone.utc).date().isoformat()
            if date_key in records or not isinstance(bucket.get('results'), list):
                raise ValueError('Duplicate or missing cost bucket.')
            items = {}
            for row in bucket['results']:
                if row.get('object') != 'organization.costs.result' or not isinstance(row.get('amount'), dict) or row['amount'].get('currency') != 'usd':
                    raise ValueError('Unexpected cost result.')
                name = row.get('line_item') or 'Unclassified'
                if not isinstance(name, str):
                    raise ValueError('Invalid cost name.')
                items[name] = items.get(name, Decimal(0)) + dollars(row['amount'].get('value'))
            records[date_key] = {'date': date_key, 'items': [{'lineItem': k, 'usd': format(v, 'f')} for k,v in sorted(items.items())]}
        if not page['has_more']:
            if params['end_time'] >= stop:
                break
            params['start_time'] = params['end_time']
            params['end_time'] = min(params['start_time'] + 31*86400, stop)
            params.pop('page', None)
            cursors.clear()
            continue
        cursor = page.get('next_page')
        if not isinstance(cursor, str) or not cursor or len(cursor)>4096 or cursor in cursors:
            raise ValueError('Invalid cost pagination.')
        cursors.add(cursor)
        params['page'] = cursor
    else:
        raise ValueError('Cost pagination limit reached.')
    through = datetime.fromtimestamp(stop-1, timezone.utc).date()
    if len(records) != (through-refresh).days+1:
        raise ValueError('Cost coverage incomplete.')
    return validate_costs({'generatedAt': now.isoformat(), 'startDate': start_date,
        'throughDate': through.isoformat(), 'currency': 'usd',
        'daily': [r for r in (previous or {}).get('daily', []) if r['date'] < refresh.isoformat()]
                 + [records[k] for k in sorted(records)]})
