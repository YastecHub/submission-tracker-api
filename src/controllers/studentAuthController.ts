import { studentAuthService } from '../modules/studentAuth/application/studentAuthService';
import { created, ok } from '../shared/http/controller';

export const requestStudentRegistrationOtp = ok((req) => studentAuthService.requestRegistrationOtp(req.body));
export const registerStudent = created((req) => studentAuthService.completeRegistration(req.body));
export const loginStudent = ok((req) => studentAuthService.login(req.body));
export const getStudent = ok((req) => studentAuthService.me(req.student!.id));
