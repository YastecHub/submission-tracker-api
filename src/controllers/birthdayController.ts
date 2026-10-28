import { file, ok } from '../shared/http/controller';
import { studentBirthdayService } from '../modules/birthdays/application/studentBirthdayService';
import { birthdayStaffService } from '../modules/birthdays/application/birthdayStaffService';

const excelContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const getMyBirthday = ok((req) => studentBirthdayService.mine(req.student!));

export const saveMyBirthday = ok((req) => studentBirthdayService.save(req.student!, req.body ?? {}, req.file ? { buffer: req.file.buffer } : undefined));

export const getStaffBirthday = ok((req) => studentBirthdayService.forStaff(req.user!));

export const getBirthdayOverview = ok(() => birthdayStaffService.overview());

export const exportBirthdays = file(async () => ({ ...(await birthdayStaffService.export()), contentType: excelContentType }));
