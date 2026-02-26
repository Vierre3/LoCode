import { homedir, userInfo } from "node:os";

export default defineEventHandler(() => {
    return {
        home: homedir(),
        user: userInfo().username,
    };
});
