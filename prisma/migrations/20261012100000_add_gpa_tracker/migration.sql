-- CreateEnum
CREATE TYPE "GpaGrade" AS ENUM ('A', 'B', 'C', 'D', 'E', 'F');

-- CreateEnum
CREATE TYPE "GpaSemesterStatus" AS ENUM ('draft', 'finalized');

-- CreateTable
CREATE TABLE "CourseCatalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "isElective" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpaSemester" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "sessionLabel" TEXT,
    "status" "GpaSemesterStatus" NOT NULL DEFAULT 'draft',
    "finalizedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GpaSemester_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpaCourse" (
    "id" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "catalogCourseId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "grade" "GpaGrade",
    "isCarryover" BOOLEAN NOT NULL DEFAULT false,
    "isRetake" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GpaCourse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseCatalog_code_key" ON "CourseCatalog"("code");

-- CreateIndex
CREATE INDEX "CourseCatalog_isActive_level_semester_sortOrder_idx" ON "CourseCatalog"("isActive", "level", "semester", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "GpaSemester_studentId_level_semester_key" ON "GpaSemester"("studentId", "level", "semester");

-- CreateIndex
CREATE INDEX "GpaCourse_catalogCourseId_idx" ON "GpaCourse"("catalogCourseId");

-- CreateIndex
CREATE UNIQUE INDEX "GpaCourse_semesterId_code_key" ON "GpaCourse"("semesterId", "code");

-- AddForeignKey
ALTER TABLE "GpaSemester" ADD CONSTRAINT "GpaSemester_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpaCourse" ADD CONSTRAINT "GpaCourse_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "GpaSemester"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpaCourse" ADD CONSTRAINT "GpaCourse_catalogCourseId_fkey" FOREIGN KEY ("catalogCourseId") REFERENCES "CourseCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
