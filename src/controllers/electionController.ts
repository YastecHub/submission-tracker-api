import type { Request } from 'express';
import { electionAdminService, type StaffUser } from '../modules/elections/application/electionAdminService';
import { studentElectionService } from '../modules/elections/application/studentElectionService';
import { ok, created } from '../shared/http/controller';

const staff = (req: Request): StaffUser => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role });
const student = (req: Request) => ({ id: req.student!.id, matricNumber: req.student!.matricNumber });
const param = (req: Request, name: string) => String(req.params[name]);
const photo = (req: Request) => (req.file ? { buffer: req.file.buffer } : undefined);

// Students
export const listMyElections = ok((req) => studentElectionService.list(student(req)));
export const getMyElection = ok((req) => studentElectionService.detail(student(req), param(req, 'id')));
export const castBallot = ok((req) => studentElectionService.vote(student(req), param(req, 'id'), req.body ?? {}));
export const getPublishedResults = ok((req) => studentElectionService.results(student(req), param(req, 'id')));
export const checkReceipt = ok((req) => studentElectionService.checkReceipt(student(req), param(req, 'id'), req.body ?? {}));

// Developer + electoral committee
export const listElections = ok((req) => electionAdminService.list(staff(req)));
export const getElection = ok((req) => electionAdminService.detail(staff(req), param(req, 'id')));
export const createElection = created((req) => electionAdminService.create(staff(req), req.body ?? {}));
export const updateElection = ok((req) => electionAdminService.update(staff(req), param(req, 'id'), req.body ?? {}));
export const deleteElection = ok((req) => electionAdminService.remove(staff(req), param(req, 'id')));
export const addPosition = ok((req) => electionAdminService.addPosition(staff(req), param(req, 'id'), req.body ?? {}));
export const updatePosition = ok((req) => electionAdminService.updatePosition(staff(req), param(req, 'id'), param(req, 'positionId'), req.body ?? {}));
export const removePosition = ok((req) => electionAdminService.removePosition(staff(req), param(req, 'id'), param(req, 'positionId')));
export const addCandidate = ok((req) => electionAdminService.addCandidate(staff(req), param(req, 'id'), req.body ?? {}, photo(req)));
export const updateCandidate = ok((req) => electionAdminService.updateCandidate(staff(req), param(req, 'id'), param(req, 'candidateId'), req.body ?? {}, photo(req)));
export const removeCandidate = ok((req) => electionAdminService.removeCandidate(staff(req), param(req, 'id'), param(req, 'candidateId')));
export const uploadVoters = ok((req) => electionAdminService.uploadVoters(staff(req), param(req, 'id'), req.body ?? {}));
export const markReady = ok((req) => electionAdminService.markReady(staff(req), param(req, 'id')));
export const backToDraft = ok((req) => electionAdminService.backToDraft(staff(req), param(req, 'id')));
export const openElection = ok((req) => electionAdminService.open(staff(req), param(req, 'id')));
export const pauseElection = ok((req) => electionAdminService.pause(staff(req), param(req, 'id')));
export const resumeElection = ok((req) => electionAdminService.resume(staff(req), param(req, 'id')));
export const extendElection = ok((req) => electionAdminService.extend(staff(req), param(req, 'id'), req.body ?? {}));
export const closeElection = ok((req) => electionAdminService.close(staff(req), param(req, 'id')));
export const remindNonVoters = ok((req) => electionAdminService.remind(staff(req), param(req, 'id')));
export const approvePublish = ok((req) => electionAdminService.approvePublish(staff(req), param(req, 'id')));
export const getElectionResults = ok((req) => electionAdminService.results(staff(req), param(req, 'id')));
export const getRegistrations = ok((req) => electionAdminService.registrations(staff(req), param(req, 'id')));
export const suspendStudent = ok((req) => electionAdminService.suspendStudent(staff(req), param(req, 'id'), param(req, 'studentId'), req.body ?? {}));
export const getAuditLog = ok((req) => electionAdminService.auditLog(staff(req), param(req, 'id')));
export const getTurnoutTimeline = ok((req) => electionAdminService.turnoutTimeline(staff(req), param(req, 'id')));
export const listCommittee = ok((req) => electionAdminService.committee(staff(req)));
