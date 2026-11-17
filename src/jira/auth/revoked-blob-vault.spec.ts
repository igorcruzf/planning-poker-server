import { RevokedBlobVault } from './revoked-blob-vault';

describe('RevokedBlobVault', () => {
    it('remembers a revocation until the ttl and forgets it afterwards', () => {
        const vault = new RevokedBlobVault(1000);
        vault.revoke('a', 0);
        expect(vault.isRevoked('a', 999)).toBe(true);
        expect(vault.isRevoked('a', 1000)).toBe(false);
        expect(vault.isRevoked('b', 0)).toBe(false);
    });

    it('discards the oldest revocation when over the limit', () => {
        const vault = new RevokedBlobVault(1000, 2);
        vault.revoke('a', 0);
        vault.revoke('b', 1);
        vault.revoke('c', 2);
        expect(vault.isRevoked('a', 3)).toBe(false);
        expect(vault.isRevoked('b', 3)).toBe(true);
        expect(vault.isRevoked('c', 3)).toBe(true);
    });

    it('drops expired entries when a new one arrives', () => {
        const vault = new RevokedBlobVault(10, 2);
        vault.revoke('a', 0);
        vault.revoke('b', 5);
        vault.revoke('c', 12);
        expect(vault.isRevoked('b', 12)).toBe(true);
        expect(vault.isRevoked('c', 12)).toBe(true);
    });
});
