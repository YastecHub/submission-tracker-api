-- A student's birthday (day and month only, never the year), filled in from the app.
CREATE TABLE "StudentBirthday" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "preferredName" TEXT,
    "shareWithClass" BOOLEAN NOT NULL DEFAULT true,
    "photoUrl" TEXT,
    "photoPublicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentBirthday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentBirthday_studentId_key" ON "StudentBirthday"("studentId");
CREATE INDEX "StudentBirthday_month_day_idx" ON "StudentBirthday"("month", "day");

ALTER TABLE "StudentBirthday" ADD CONSTRAINT "StudentBirthday_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per celebration sent (birthday email, classmates' notification), so each goes out once a year.
CREATE TABLE "BirthdayCelebration" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayCelebration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BirthdayCelebration_studentId_year_kind_key" ON "BirthdayCelebration"("studentId", "year", "kind");

ALTER TABLE "BirthdayCelebration" ADD CONSTRAINT "BirthdayCelebration_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
