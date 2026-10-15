-- Elections (secret ballot), electoral committee role, seeded roster emails and
-- account suspension.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'electoral_committee';

-- CreateEnum
CREATE TYPE "ElectionStatus" AS ENUM ('draft', 'ready', 'open', 'paused', 'closed', 'published');

-- AlterTable
ALTER TABLE "StudentAccount" ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "StudentRoster" ADD COLUMN "email" TEXT;

-- CreateTable
CREATE TABLE "Election" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ElectionStatus" NOT NULL DEFAULT 'draft',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "registrationDeadline" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Election_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionPosition" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectionPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionCandidate" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "matricNumber" TEXT,
    "displayName" TEXT NOT NULL,
    "nickname" TEXT,
    "photoUrl" TEXT,
    "photoPublicId" TEXT,
    "manifesto" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionVoterRoll" (
    "electionId" TEXT NOT NULL,
    "matricNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionVoterRoll_pkey" PRIMARY KEY ("electionId","matricNumber")
);

-- CreateTable
CREATE TABLE "ElectionVoteRecord" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "matricNumber" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionVoteRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionBallot" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "castHour" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectionBallot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionBallotChoice" (
    "id" TEXT NOT NULL,
    "ballotId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "approve" BOOLEAN,

    CONSTRAINT "ElectionBallotChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectionPublishApproval" (
    "electionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionPublishApproval_pkey" PRIMARY KEY ("electionId","userId")
);

-- CreateTable
CREATE TABLE "ElectionAuditLog" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentRoster_email_key" ON "StudentRoster"("email");

-- CreateIndex
CREATE INDEX "Election_status_idx" ON "Election"("status");

-- CreateIndex
CREATE INDEX "ElectionPosition_electionId_sortOrder_idx" ON "ElectionPosition"("electionId", "sortOrder");

-- CreateIndex
CREATE INDEX "ElectionCandidate_positionId_sortOrder_idx" ON "ElectionCandidate"("positionId", "sortOrder");

-- CreateIndex
CREATE INDEX "ElectionCandidate_electionId_idx" ON "ElectionCandidate"("electionId");

-- CreateIndex
CREATE INDEX "ElectionVoteRecord_electionId_votedAt_idx" ON "ElectionVoteRecord"("electionId", "votedAt");

-- CreateIndex
CREATE INDEX "ElectionVoteRecord_studentId_idx" ON "ElectionVoteRecord"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionVoteRecord_electionId_matricNumber_key" ON "ElectionVoteRecord"("electionId", "matricNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionVoteRecord_electionId_studentId_key" ON "ElectionVoteRecord"("electionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionBallot_electionId_receiptHash_key" ON "ElectionBallot"("electionId", "receiptHash");

-- CreateIndex
CREATE INDEX "ElectionBallotChoice_positionId_candidateId_idx" ON "ElectionBallotChoice"("positionId", "candidateId");

-- CreateIndex
CREATE INDEX "ElectionBallotChoice_candidateId_idx" ON "ElectionBallotChoice"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectionBallotChoice_ballotId_positionId_key" ON "ElectionBallotChoice"("ballotId", "positionId");

-- CreateIndex
CREATE INDEX "ElectionPublishApproval_userId_idx" ON "ElectionPublishApproval"("userId");

-- CreateIndex
CREATE INDEX "ElectionAuditLog_electionId_createdAt_idx" ON "ElectionAuditLog"("electionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Election" ADD CONSTRAINT "Election_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionPosition" ADD CONSTRAINT "ElectionPosition_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionCandidate" ADD CONSTRAINT "ElectionCandidate_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionCandidate" ADD CONSTRAINT "ElectionCandidate_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "ElectionPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionVoterRoll" ADD CONSTRAINT "ElectionVoterRoll_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionVoteRecord" ADD CONSTRAINT "ElectionVoteRecord_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionVoteRecord" ADD CONSTRAINT "ElectionVoteRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionBallot" ADD CONSTRAINT "ElectionBallot_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionBallotChoice" ADD CONSTRAINT "ElectionBallotChoice_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "ElectionBallot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionBallotChoice" ADD CONSTRAINT "ElectionBallotChoice_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "ElectionPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionBallotChoice" ADD CONSTRAINT "ElectionBallotChoice_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ElectionCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionPublishApproval" ADD CONSTRAINT "ElectionPublishApproval_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionPublishApproval" ADD CONSTRAINT "ElectionPublishApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectionAuditLog" ADD CONSTRAINT "ElectionAuditLog_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;
