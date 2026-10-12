import { gpaService } from '../modules/gpa/application/gpaService';
import { created, ok } from '../shared/http/controller';
import { routeParam } from '../shared/http/param';

// Every handler uses the signed-in student's id from their token. There is no
// way to read or change another student's GPA, and no class rep access.
export const getGpaRecord = ok((req) => gpaService.getRecord(req.student!.id));
export const getCourseCatalog = ok(() => gpaService.catalog());
export const createGpaSemester = created((req) => gpaService.createSemester(req.student!.id, req.body));
export const updateGpaSemester = ok((req) => gpaService.updateSemester(req.student!.id, routeParam(req.params.id), req.body));
export const finalizeGpaSemester = ok((req) => gpaService.finalizeSemester(req.student!.id, routeParam(req.params.id), req.body));
export const unlockGpaSemester = ok((req) => gpaService.unlockSemester(req.student!.id, routeParam(req.params.id), req.body));
export const deleteGpaSemester = ok((req) => gpaService.deleteSemester(req.student!.id, routeParam(req.params.id)));
export const importGpaCsv = ok((req) => gpaService.importCsv(req.student!.id, req.body));
