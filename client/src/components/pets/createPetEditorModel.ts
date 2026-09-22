import { IPetType, ISelectOption } from '../../types';
import { apiFetch } from '../../util';

const toSelectOptions = (pettypes: IPetType[]): ISelectOption[] => pettypes.map(pettype => ({ value: pettype.id, name: pettype.name }));

export default (ownerId: string, petLoaderPromise: Promise<any>): Promise<any> => {
  return Promise.all(
    [apiFetch('/api/pettypes')
      .then(response => response.json())
      .then(toSelectOptions),
    apiFetch('/api/owners/' + ownerId)
      .then(response => response.json()),
      petLoaderPromise,
    ]
  ).then(results => ({
    pettypes: results[0],
    owner: results[1],
    pet: results[2]
  }));
};
