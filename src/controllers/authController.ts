import { authService } from '../modules/auth/application/authService';
import { created, ok } from '../shared/http/controller';

export const login = ok((req) => authService.login(req.body));

export const savePushSubscription = ok((req) =>
  authService.savePushSubscription(req.user!.id, req.body.subscription)
);

export const updateProfile = ok((req) =>
  authService.updateProfile(req.user!.id, req.body)
);

export const changePassword = ok((req) =>
  authService.changePassword(req.user!.id, req.body)
);

export const createUser = created((req) =>
  authService.createUser(req.user!.role, req.body)
);

export const me = ok((req) => authService.me(req.user!.id));
