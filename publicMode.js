const EventEmitter = require('events');

class AccessControl extends EventEmitter {
    constructor() {
        super();
        this.sockets = new Map();
    }

    registerSocket(socket, { isAdmin = false } = {}) {
        const record = {
            id: socket.id,
            socket,
            isAdmin: Boolean(isAdmin),
            canDrive: Boolean(isAdmin),
            displayName: socket.handshake?.auth?.name || socket.id
        };

        this.sockets.set(socket.id, record);
        socket.data = socket.data || {};
        socket.data.access = {
            isAdmin: record.isAdmin
        };

        this.emit('registered', this._publicRecord(record));
        this.emit('driverAccessChanged', { socketId: socket.id, canDrive: record.canDrive });
        return record;
    }

    unregisterSocket(socketId) {
        const record = this.sockets.get(socketId);
        if (!record) {
            return null;
        }

        this.sockets.delete(socketId);
        this.emit('unregistered', this._publicRecord(record));
        return record;
    }

    hasSocket(socketId) {
        return this.sockets.has(socketId);
    }

    getSocket(socketId) {
        return this.sockets.get(socketId) || null;
    }

    setDrivingAllowed(socketId, allowed) {
        const record = this.sockets.get(socketId);
        if (!record) {
            return false;
        }

        const desiredState = record.isAdmin ? true : Boolean(allowed);
        if (record.canDrive === desiredState) {
            return record.canDrive;
        }

        record.canDrive = desiredState;
        this.emit('driverAccessChanged', { socketId: record.id, canDrive: record.canDrive });
        return record.canDrive;
    }

    setDrivingForAllNonAdmins(allowed) {
        const results = [];
        this.sockets.forEach((record) => {
            if (!record.isAdmin) {
                results.push(this.setDrivingAllowed(record.id, allowed));
            }
        });
        return results;
    }

    canDrive(socketId) {
        const record = this.sockets.get(socketId);
        return record ? record.canDrive : false;
    }

    isAdmin(socketId) {
        const record = this.sockets.get(socketId);
        return record ? record.isAdmin : false;
    }

    list() {
        return Array.from(this.sockets.values()).map((record) => this._publicRecord(record));
    }

    listNonAdmins() {
        return this.list().filter((record) => !record.isAdmin);
    }

    _publicRecord(record) {
        return {
            id: record.id,
            isAdmin: record.isAdmin,
            canDrive: record.canDrive,
            displayName: record.displayName
        };
    }
}

module.exports = new AccessControl();
