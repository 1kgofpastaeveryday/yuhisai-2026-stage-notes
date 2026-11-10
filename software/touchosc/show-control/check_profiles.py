"""Check GROUP_NAME locator syntax with synthetic cues; do not write profiles."""
from build_profiles import acts_from_cues

def main():
    parse=acts_from_cues
    cues=[{'name':'[C2_LoveLanguage]','beat':1},
          {'name':'[C2_LoveLanguage] SETSTOP','beat':2},
          {'name':'[DFS_Second_Part]','beat':3},
          {'name':'[DFS_Second_Part] SETSTOP','beat':4}]
    acts,issues=parse(cues)
    assert not issues and [a['title'] for a in acts]==['LoveLanguage','Second_Part']
    assert [(a['start'],a['end']) for a in acts]==[(1,2),(3,4)]
    assert [a['start_locator'] for a in acts]==[cues[0]['name'],cues[2]['name']]
    assert parse(cues,'C2_')==(acts,issues)
    print('PASS synthetic GROUP_NAME: paired by full name, split first underscore, Live position order')
    for bad in ['[C2_Love Language]','[C2_Love Language] SETSTOP']:
        try:
            parse([{'name':bad,'beat':1}])
        except ValueError as error:
            print('PASS rejected: '+str(error))
        else:
            raise AssertionError('Accepted spaces in '+bad)

if __name__=='__main__':
    main()
