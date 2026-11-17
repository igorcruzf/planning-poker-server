import { JIRA_SWEEP_INTERVAL_MS, JiraAuthMaintenance } from './jira-auth-maintenance';
import { JiraLoginService } from './jira-login.service';
import { JiraSessionService } from './jira-session.service';

describe('JiraAuthMaintenance', () => {
    let login: { sweep: jest.Mock };
    let sessions: { sweep: jest.Mock };
    let maintenance: JiraAuthMaintenance;

    beforeEach(() => {
        jest.useFakeTimers();
        login = { sweep: jest.fn() };
        sessions = { sweep: jest.fn() };
        maintenance = new JiraAuthMaintenance(
            login as unknown as JiraLoginService,
            sessions as unknown as JiraSessionService,
        );
    });

    afterEach(() => {
        maintenance.onModuleDestroy();
        jest.useRealTimers();
    });

    it('sweeps states, codes and cached sessions on every interval', () => {
        maintenance.onModuleInit();
        jest.advanceTimersByTime(JIRA_SWEEP_INTERVAL_MS * 3);
        expect(login.sweep).toHaveBeenCalledTimes(3);
        expect(sessions.sweep).toHaveBeenCalledTimes(3);
    });

    it('cancels the interval when the module is destroyed', () => {
        maintenance.onModuleInit();
        maintenance.onModuleDestroy();
        jest.advanceTimersByTime(JIRA_SWEEP_INTERVAL_MS * 3);
        expect(login.sweep).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('does not keep the process alive', () => {
        maintenance.onModuleInit();
        const timer = (maintenance as unknown as { timer: NodeJS.Timeout }).timer;
        expect(timer.hasRef()).toBe(false);
    });
});
