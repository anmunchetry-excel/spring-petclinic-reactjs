import * as React from 'react';

import { IOwner, IEditablePet, ISelectOption } from '../../types';

import { apiFetch } from '../../util';

import LoadingPanel from './LoadingPanel';
import PetEditor from './PetEditor';

import createPetEditorModel from './createPetEditorModel';

interface IEditPetPageProps {
  params: {
    ownerId: string,
    petId: string
  };
}

interface IEditPetPageState {
  pet?: IEditablePet;
  owner?: IOwner;
  pettypes?: ISelectOption[];
};

export default class EditPetPage extends React.Component<IEditPetPageProps, IEditPetPageState> {

  componentDidMount() {
    const { params } = this.props;

    const loadPetPromise = apiFetch(`/api/owners/${params.ownerId}/pets/${params.petId}`)
      .then(response => response.json());

    createPetEditorModel(this.props.params.ownerId, loadPetPromise)
      .then(model => this.setState(model));
  }

  render() {
    if (!this.state) {
      return <LoadingPanel />;
    }

    return <PetEditor {...this.state} />;
  }
}
