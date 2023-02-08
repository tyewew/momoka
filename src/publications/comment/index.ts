import { BigNumber } from 'ethers';
import { checkDAProof } from '../../';
import { ClaimableValidatorError } from '../../claimable-validator-errors';
import { failure, PromiseResult, success } from '../../da-result';
import { CreateCommentEIP712TypedData } from '../../data-availability-models/publications/data-availability-publication-typed-data';
import {
  DAPublicationPointerType,
  DAStructurePublication,
} from '../../data-availability-models/publications/data-availability-structure-publication';
import { DACommentCreatedEventEmittedResponse } from '../../data-availability-models/publications/data-availability-structure-publications-events';
import { EMPTY_BYTE, getOnChainProfileDetails } from '../../ethereum';
import { whoSignedTypedData } from '../publication.base';

export type CheckDACommentPublication = DAStructurePublication<
  DACommentCreatedEventEmittedResponse,
  CreateCommentEIP712TypedData
>;

const crossCheckEvent = async (
  event: DACommentCreatedEventEmittedResponse,
  typedData: CreateCommentEIP712TypedData,
  pubCountAtBlock: string,
  log: (message: string, ...optionalParams: any[]) => void
): PromiseResult => {
  // compare all event emitted to typed data value
  log('cross check event with typed data value');

  // check the pub count makes sense from the block!
  if (BigNumber.from(pubCountAtBlock).add(1).toHexString() !== event.pubId) {
    return failure(ClaimableValidatorError.EVENT_MISMATCH);
  }

  log('pub count at block is correct');

  // compare all others!
  if (
    typedData.value.profileId !== event.profileId ||
    typedData.value.contentURI !== event.contentURI ||
    typedData.value.profileIdPointed !== event.profileIdPointed ||
    typedData.value.pubIdPointed !== event.pubIdPointed ||
    typedData.value.collectModule !== event.collectModule ||
    event.collectModuleReturnData !== EMPTY_BYTE ||
    typedData.value.referenceModule !== event.referenceModule ||
    event.referenceModuleReturnData !== EMPTY_BYTE
  ) {
    return failure(ClaimableValidatorError.EVENT_MISMATCH);
  }

  log('cross check event is complete');

  return success();
};

export const checkDAComment = async (
  publication: CheckDACommentPublication,
  verifyPointer: boolean,
  log: (message: string, ...optionalParams: any[]) => void
): PromiseResult => {
  log('check DA comment');

  if (!publication.chainProofs.pointer) {
    return failure(ClaimableValidatorError.PUBLICATION_NO_POINTER);
  }

  if (publication.chainProofs.pointer.type !== DAPublicationPointerType.ON_DA) {
    return failure(ClaimableValidatorError.PUBLICATION_NONE_DA);
  }

  if (verifyPointer) {
    log('verify pointer first');

    // check the pointer!
    const pointerResult = await checkDAProof(publication.chainProofs.pointer.location, {
      verifyPointer: false,
      log,
    });
    if (pointerResult.isFailure()) {
      return failure(pointerResult.failure!);
    }
  }

  const typedData = publication.chainProofs.thisPublication.typedData;

  const whoSignedResult = whoSignedTypedData(
    typedData.domain,
    typedData.types,
    typedData.value,
    publication.chainProofs.thisPublication.signature
  );

  if (whoSignedResult.isFailure()) {
    return failure(whoSignedResult.failure!);
  }

  const whoSigned = whoSignedResult.successResult!;

  log('who signed', whoSigned);

  const details = await getOnChainProfileDetails(
    publication.chainProofs.thisPublication.blockNumber,
    typedData.value.profileId,
    whoSigned
  );

  if (details.sigNonce !== typedData.value.nonce) {
    log('nonce mismatch', { expected: details.sigNonce, actual: typedData.value.nonce });
    return failure(ClaimableValidatorError.PUBLICATION_NONCE_INVALID);
  }

  if (details.dispatcherAddress !== whoSigned && details.ownerOfAddress !== whoSigned) {
    return failure(ClaimableValidatorError.PUBLICATION_SIGNER_NOT_ALLOWED);
  }

  const eventResult = await crossCheckEvent(
    publication.event,
    typedData,
    details.currentPublicationId,
    log
  );

  log('finished checking DA comment');

  return eventResult;
};
