import { UserInfo } from './user-info';

export const VOTE_FIELD = 'votedValue';
export const NO_VOTE = '';
export const HIDDEN_VOTE = '*';

const hasVote = (user: UserInfo): boolean => {
    const vote = user[VOTE_FIELD];
    return vote !== undefined && vote !== null && vote !== NO_VOTE;
};

export const hideVote = (user: UserInfo): UserInfo => (hasVote(user) ? { ...user, [VOTE_FIELD]: HIDDEN_VOTE } : user);

export const clearVote = (user: UserInfo): UserInfo => ({ ...user, [VOTE_FIELD]: NO_VOTE });
