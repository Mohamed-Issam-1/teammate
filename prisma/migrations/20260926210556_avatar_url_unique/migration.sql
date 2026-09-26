-- CreateIndex
-- A non-null avatarUrl identifies exactly one profile, so a token can never
-- resolve ambiguously to the wrong account. PostgreSQL permits unlimited NULLs
-- under a unique index, so profiles without an avatar are unaffected.
--
-- Additive only: a new unique index, with no table or column dropped and no
-- existing data rewritten.
CREATE UNIQUE INDEX "Profile_avatarUrl_key" ON "Profile"("avatarUrl");