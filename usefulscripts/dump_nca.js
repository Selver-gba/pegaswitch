// 'use strict';

sc.getFSPPR = function () {
	if (sc.closed_pr !== undefined) {
		return;
	}
	sc.enableTurbo();
	var i = 0;
	var srv = null;
	while (true) {
		sc.ipcMsg(2).setType(5).sendTo('pm:shell');
		var srvResult = sc.getService("fsp-pr");
		if(srvResult.isOk) {
			srv = srvResult.getValue();
			break;
		}
		i++;
	}
	utils.log('Got fsp-pr handle after ' + i + ' iterations: ');
	utils.log('fsp-pr handle: 0x' + srv.toString(16));
	sc.svcCloseHandle(srv).assertOk();
	sc.closed_pr = true;
};

sc.getFSPPR();
sc.enableTurbo();

if(sc.pr_handle) {
	sc.svcCloseHandle(sc.pr_handle);
	sc.pr_handle = undefined;
}

dumpNCA = function(nca_id, ncm_hnd, sd_hnd, file_path, is_exfat) {
	if (is_exfat == undefined) {
		is_exfat = false;
	}
	sc.withHandle(ncm_hnd, () => {
		// var size = GetRegisteredEntrySize();
		var size = sc.ipcMsg(14).datau32(nca_id[0], nca_id[1], nca_id[2], nca_id[3]).sendTo(ncm_hnd).assertOk();
		size = [size.data[0], size.data[1]];
		utils.log('NCA size: '+utils.paddr(size));
		var two_gigs = 0x80000000 >>> 0;

		var outbuf = new ArrayBuffer(0x1000000);
		var buf_sz = 0x1000000;

		var out_path = file_path;
		if ((size[1] > 0 || size[0] > two_gigs) && !is_exfat) {
			out_path = file_path + '.0';
			createFile(sd_hnd, out_path, two_gigs);
		} else {
			createFile(sd_hnd, out_path, size);
		}

		var f_hnd = openFile(sd_hnd, out_path);

		var offset = [0, 0];

		var ofs_in_file = 0;
		var file_num = 0;

		while (offset[0] < size[0] || offset[1] < size[1]) {
			if (offset[1] == size[1] && size[0] < offset[0] + buf_sz) {
				buf_sz = size[0] - offset[0];
				utils.log('Final block!');
			}

			// var data = ReadRegisteredEntry();
			sc.ipcMsg(18).datau32(nca_id[0], nca_id[1], nca_id[2], nca_id[3], offset[0], offset[1]).bDescriptor(outbuf, buf_sz).sendTo(ncm_hnd).assertOk().show();
			writeBufferToFile(f_hnd, ofs_in_file, outbuf, buf_sz);

			offset = utils.add2(offset, buf_sz);
			utils.log('Dumped: '+utils.paddr(offset)+'/'+utils.paddr(size));

			// Multi-part files.
			ofs_in_file += buf_sz;
			if (ofs_in_file >= two_gigs && !is_exfat) {
				sc.ipcMsg(2).sendTo(f_hnd).assertOk(); // flush
				sc.svcCloseHandle(f_hnd);
				file_num++;
				var new_path = file_path + '.' + file_num;
				if (size[1] > offset[1] || size[0] > two_gigs + offset[0]) {
					createFile(sd_hnd, new_path, two_gigs);
				} else {
					createFile(sd_hnd, new_path, size[0] - offset[0]);
				}
				f_hnd = openFile(sd_hnd, new_path);
				ofs_in_file = 0;
			}
		}
		sc.ipcMsg(2).sendTo(f_hnd).assertOk();
		sc.svcCloseHandle(f_hnd).assertOk();
	});
};

dumpIFile = function(ifl_hnd, sd_hnd, file_path, is_exfat) {
	if (is_exfat == undefined) {
		is_exfat = false;
	}
	sc.withHandle(ifl_hnd, () => {
		var size = sc.ipcMsg(4).datau64(0).sendTo(ifl_hnd).assertOk().data;
		utils.log('Size: '+utils.paddr(size));
		var two_gigs = 0x80000000 >>> 0;

		var outbuf = new ArrayBuffer(0x1000000);
		var buf_sz = 0x1000000;

		var out_path = file_path;
		if ((size[1] > 0 || size[0] > two_gigs) && !is_exfat) {
			out_path = file_path + '.0';
			createFile(sd_hnd, out_path, two_gigs);
		} else {
			createFile(sd_hnd, out_path, size);
		}

		var f_hnd = openFile(sd_hnd, out_path);

		var offset = [0, 0];

		var ofs_in_file = 0;
		var file_num = 0;

		while (offset[0] < size[0] || offset[1] < size[1]) {
			if (offset[1] == size[1] && size[0] < offset[0] + buf_sz) {
				buf_sz = size[0] - offset[0];
				utils.log('Final block!');
			}

			sc.ipcMsg(0).datau64(0, offset, buf_sz).bDescriptor(outbuf, buf_sz, 1).sendTo(ifl_hnd).assertOk();
			writeBufferToFile(f_hnd, ofs_in_file, outbuf, buf_sz);

			offset = utils.add2(offset, buf_sz);
			utils.log('Dumped: '+utils.paddr(offset)+'/'+utils.paddr(size));

			// Multi-part files.
			ofs_in_file += buf_sz;
			if (ofs_in_file >= two_gigs && !is_exfat) {
				sc.ipcMsg(2).sendTo(f_hnd).assertOk(); // flush
				sc.svcCloseHandle(f_hnd);
				file_num++;
				var new_path = file_path + '.' + file_num;
				if (size[1] > offset[1] || size[0] > two_gigs + offset[0]) {
					createFile(sd_hnd, new_path, two_gigs);
				} else {
					createFile(sd_hnd, new_path, size[0] - offset[0]);
				}
				f_hnd = openFile(sd_hnd, new_path);
				ofs_in_file = 0;
			}
		}
		sc.ipcMsg(2).sendTo(f_hnd).assertOk();
		sc.svcCloseHandle(f_hnd).assertOk();
		sc.ipcMsg(2).sendTo(ifl_hnd).assertOk();
	});
};


openRootDirectory = function(ifs_hnd) {
	return openDirectory('/', ifs_hnd);
};

openDirectory = function(path, ifs_hnd) {
	var pbuf = utils.str2ab(path);
	var res = sc.ipcMsg(9).datau32(3).xDescriptor(pbuf, pbuf.byteLength, 0).sendTo(ifs_hnd).asResult().map((r) => r.movedHandles[0]).getValue();
};

createFile = function(ifs_hnd, path, size) {
	if (size == undefined) {
		size = 0x100;
	}
	var pbuf = utils.str2ab(path);
	var res = sc.ipcMsg(0).data([0, 0], utils.trunc32(size)).xDescriptor(pbuf, pbuf.byteLength, 0).sendTo(ifs_hnd);
	utils.log('Create '+path+' (size '+size.toString(16)+'): ');
	res.show();
	// ignore failure, it probably just means the file already existed
	//res.assertOk();
};

createDirectory = function(ifs_hnd, path) {
	var pbuf = utils.str2ab(path);
	var res = sc.ipcMsg(2).data([0, 0]).xDescriptor(pbuf, pbuf.byteLength, 0).sendTo(ifs_hnd);
	utils.log('Create '+path+': ');
	res.show();

};

writeBufferToFile = function(f_hnd, offset, buf, sz) {
	sc.ipcMsg(1).aDescriptor(buf, sz, 1).data([0,0], utils.pad64(offset), utils.trunc32(sz)).sendTo(f_hnd).show().assertOk();
};

openFile = function(ifs_hnd, path) {
	var pbuf = utils.str2ab(path);
	utils.log('Open '+path+': ');
	return sc.ipcMsg(8).datau32(3).xDescriptor(pbuf, pbuf.byteLength, 0).sendTo(ifs_hnd).show().asResult().map((r) => r.movedHandles[0]).getValue();
};
openReadFile = function(ifs_hnd, path) {
	var pbuf = utils.str2ab(path);
	utils.log('Open '+path+': ');
	return sc.ipcMsg(8).datau32(1).xDescriptor(pbuf, pbuf.byteLength, 0).sendTo(ifs_hnd).show().asResult().map((r) => r.movedHandles[0]).getValue();
};

// define enums
const TYPE_CNMT = 0;
const TYPE_PROGRAM = 1;
const TYPE_DATA = 2;
const TYPE_ICON = 3;
const TYPE_DOC = 4;
const TYPE_INFO = 5;

const STORAGE_NONE = 0;
const STORAGE_HOST = 1;
const STORAGE_GAMECARD = 2;
const STORAGE_NANDSYS = 3;
const STORAGE_NANDUSER = 4;
const STORAGE_SDCARD = 5;

// Configure these as desired.
// See, for example, http://switchbrew.org/index.php?title=Title_list/Games
const TITLE_ID_NAMES = {
	'0100000000010000' : 'Super Mario Odyssey™',
	'01000A10041EA000' : 'The Elder Scrolls V: Skyrim',
	'0100152000022000' : 'Mario Kart™ 8 Deluxe',
	'0100225000FEE000' : 'Blaster Master Zero',
	'0100230005A52000' : 'Lovers in a Dangerous Spacetime',
	'010031F002B66000' : 'Mr. Shifty',
	'01003870040FA000' : 'Splatoon™ 2: Splatfest World Premiere',
	'01003A30012C0000' : 'LEGO® CITY Undercover (US)',
	'01003BC0000A0000' : 'Splatoon™ 2',
	'01005B9002312000' : 'The Binding of Isaac: Afterbirth+',
	'01006BD001E06000' : 'Minecraft: Nintendo Switch Edition',
	'0100704000B3A000' : 'Snipperclips™ – Cut it out, together!',
	'010073C001D5E000' : 'Puyo Puyo Tetris',
	'01007EF00011E000' : 'The Legend of Zelda™: Breath of the Wild',
	'0100838002AEA000' : 'LEGO® Worlds',
	'0100849000BDA000' : 'I Am Setsuna',
	'010085500130A000' : 'LEGO® CITY Undercover (EUR)',
	'0100A55003B5C000' : 'Cave Story+ (EUR)',
	'0100AE0003424000' : 'Shantae: Half-Genie Hero',
	'0100B1A0066DC000' : 'Volgarr the Viking',
	'0100B3F000BE2000' : 'Pokkén Tournament™ DX',
	'0100B7D0022EE000' : 'Cave Story+ (US)',
	'0100BE50042F6000' : 'Yono and the Celestial Elephants',
};


// Actual function start...
dumpTitle = function(titleIdInput, titleTypeInput, titleStorageInput, gamecardPartitionInput) {
	const titleId = titleIdInput;
	const titleType = titleTypeInput;
	const titleStorage = titleStorageInput;
	if (true) { // parameter validation
		if (arguments.length !== 3) {
			const errMsg = 'dumpTitle requires three arguments';
			utils.log(errMsg); throw new Error(errMsg);		
		}
		if (titleId.constructor !== String) {
			const errMsg = 'titleId must be hex string (e.g. 0100000000010000)';
			utils.log(errMsg); throw new Error(errMsg);
		}
		if (titleId.length !== 16) {
			const errMsg = 'titleId must be hex string (e.g. 0100000000010000)';
			utils.log(errMsg); throw new Error(errMsg);
		}
		if ((titleType.constructor !== Number) || (titleType < 0) || (titleType > 5)) {
			const errMsg = 'titleType must be Number between (0..5)';
			utils.log(errMsg); throw new Error(errMsg);
		}
		if ((titleStorage.constructor !== Number) || (titleStorage < 0) || (titleStorage > 5)) {
			const errMsg = 'titleStorage must be Number between (0..5)';
			utils.log(errMsg); throw new Error(errMsg);
		}
	} // end parameter validation
	// default gamecard partition is 2 (secure)
	const gamecardParititon = (
		(titleStorage === 2) && // titleStorage is the gamecard...
		(arguments.length >= 4) && // and argument was provided for gamecardPartitionInput
		(gamecardPartitionInput.constructor === Number) && // and that argument was a number
		(gamecardPartitionInput >= 0) && (gamecardPartitionInput <= 2)) ? gamecardPartitionInput : 2;
	/*
	// fsp-pr is the program registry... used to set full permissions on the titleId / titleStorage
	sc.getService("fsp-pr", (fsppr) => {
		// get the PID using fsp-srv
		const pid = sc.getService('fsp-srv', (tmp_hnd) => {
			utils.log("got fspsrv");
			sc.ipcMsg(1).sendPid().data(0).sendTo(tmp_hnd).assertOk();
			return sc.read4(sc.ipcBufAddr, 0xC >> 2);
		});
		utils.log('Got process PID: '+pid.toString(16));
		
		const buf1_sz = 0x1C; // sizeof(FS_ACCESS_HEADER)
		const buf2_sz = 0x2C; // sizeof(FS_ACCESS_CONTROL)
		const buf = sc.malloc(buf1_sz + buf2_sz);
		const buf2 = utils.add2(buf, buf1_sz);
		
		// buffer init -- fill in FS_ACCESS_HEADER and FS_ACCESS_CONTROL
		sc.write4(1, buf, 0x0>>2);
		sc.write8([0xFFFFFFFF, 0xFFFFFFFF], buf, 0x4 >> 2); // This is the permissions value.
		sc.write4(buf1_sz, buf, 0xC >> 2);
		sc.write4(buf1_sz, buf, 0x14 >> 2);
		
		sc.write4(1, buf2, 0x0 >> 2);
		sc.write8([0xFFFFFFFF, 0xFFFFFFFF], buf2, 0x4 >> 2); // This is the permissions value -- actual perms = buf2_val & buf1_val
		sc.write4(0xFFFFFFFF, buf2, 0x14 >> 2);
		sc.write4(0xFFFFFFFF, buf2, 0x18 >> 2);
		sc.write4(0xFFFFFFFF, buf2, 0x24 >> 2);
		sc.write4(0xFFFFFFFF, buf2, 0x28 >> 2);
		
		// fsp-pr IPC messages: https://roblabla.github.io/SwIPC/ifaces.html#nn::fssrv::sf::IProgramRegistry
		// 
		// Msg 256 == SetEnabledProgramVerification(u8 enabled) -- called with zero to disable verification
		sc.ipcMsg(256).data(0).sendTo(fsppr).assertOk().show();
		// Msg   1 == ClearFsPermissions(u64 pid) -- clear any existing permissions this PID might have to that title...
		sc.ipcMsg(1).data(pid).sendTo(fsppr).assertOk().show();
		// Create the message.  Allows me to dump this message to console as needed....
		var setPermissionsMessage = 
		sc
			.ipcMsg(0)
			.data(
				titleStorage,
				[pid,0],
				utils.parseAddr(titleId),
				buf1_sz,
				buf2_sz,
				pid, pid,
				0, 0, 0, 0, 0
			)
			.aDescriptor(buf, buf1_sz)
			.aDescriptor(buf2, buf2_sz);
		// 
		setPermissionsMessage.show().sendTo(fsppr).assertOk().show();
		sc.free(buf);
	});
	*/
	/*
	// Get the desired NCA ID
	var nca_id = new Uint32Array(4);
	sc.ipcMsg(5).datau32(titleStorage).sendTo('ncm').asResult().andThen(res => {
		sc.withHandle(res.movedHandles[0], function(hnd) {
			
			// var meta_record = GetMetaRecord(TITLE_ID);
			var res = sc.ipcMsg(6).datau64(utils.parseAddr(titleId)).sendTo(hnd).assertOk();
			var metaRecord = new Uint32Array(4);
			for (var i = 0; i < 4; i++) {
				metaRecord[i] = res.data[i];
				utils.log('metaRecord[i] == 0x' + metaRecord[i].toString(16));
			}

			// var nca_id = GetEntryContentNcaId(meta_record, TITLE_TYPE);
			// HACKHACK -- padding zero after title_type?? (maybe to get 64-bit alignment for res.data[] ???)
			res = sc.ipcMsg(3).datau32(titleType, 0, res.data[0], res.data[1], res.data[2], res.data[3]).sendTo(hnd).assertOk();
			for (var i = 0; i < 4; i++) {
				nca_id[i] = res.data[i];
			}
		});
	});
	*/
	/*
	// Get NCA string for pretty printing.
	var nca_id_str = '';
	if (true) {
		for (var i = 0; i < 4; i++) {
			var val = nca_id[i];
			for (var j = 0; j < 4; j++) {
				var b = (val >> (j*8)) & 0xFF;
				nca_id_str += ('00' + b.toString(16)).slice(-2);
			}
		}
		if (titleType == TYPE_CNMT) {
			nca_id_str += '.cnmt';
		}
		nca_id_str += '.nca';
	}
	utils.log('Found NCA: '+nca_id_str);
	*/
	/*
	// Get handle to SD card
	sc.getService('fsp-srv', (hnd) => {
		utils.log('Using fsp-srv handle: 0x' + hnd.toString(16));
		sc.ipcMsg(1).sendPid().datau64(0).sendTo(hnd).assertOk();
		utils.log("initialized fsp-srv");	
		try {
			var sd_mnt = sc.ipcMsg(18).sendTo(hnd).assertOk();
		} catch(e) {
			throw new Error("Failed to open SD card. Is it inserted?");
		}	
		utils.log("Opened SD card.");
		
		if (titleStorage == STORAGE_GAMECARD) {
			utils.log('Getting gamecard handle...');
			var ido_res = sc.ipcMsg(400).sendTo(hnd).assertOk();
			var gc_hnd = undefined;
			sc.withHandle(ido_res.movedHandles[0], (ido_hnd) => {
				gc_hnd = sc.ipcMsg(202).sendTo(ido_hnd).assertOk().data[0];
			});
			utils.log('Gamecard handle: '+gc_hnd);

			sd_mnt.withHandles((r, m, c) => {
				var sd_hnd = m[0];
				var nca_id_path = '/ncas';
				createDirectory(sd_hnd, nca_id_path);
				// ugly hack to generate unique name based on title storage type
				nca_id_path += '/'+['None', 'Host', 'Gamecard', 'System', 'User', 'Sdcard'][titleStorage];
				if (gamecardParititon === 0) { nca_id_path += '-update'; }
				else if (gamecardParititon === 1) { nca_id_path += '-nonSecure'; }
				else {}

				createDirectory(sd_hnd, nca_id_path);
				nca_id_path += '/'+titleId;
				createDirectory(sd_hnd, nca_id_path);
				nca_id_path += '/'+nca_id_str;

				// now send commands to open and read from the gamecard
				var res = sc.ipcMsg(31).datau32(gc_hnd, gamecardParititon).sendTo(hnd).show().asResult();
				if (res.isOk) {  
					res = res.getValue(); // unused, so not actually required here?
					sc.withHandle(res.movedHandles[0], (gc_fs_hnd) => {
						var nca_hnd = openReadFile(gc_fs_hnd, '/'+nca_id_str);
						dumpIFile(nca_hnd, sd_hnd, nca_id_path, false);
					});
				} else {
					utils.log('Failed to mount gamecard partition to ' + nca_id_path);
				}
			});
		} else {
			// Dump the desired NCA from someplace OTHER than a gamecard
			sc.ipcMsg(4).datau32(titleStorage).sendTo('ncm').asResult().andThen(res => {
				sc.withHandle(res.movedHandles[0], function(ncm_hnd) {
					sd_mnt.withHandles((r, m, c) => {
						var sd_hnd = m[0];
						var nca_id_path = '/ncas';
						createDirectory(sd_hnd, nca_id_path);
						// ugly hack to generate unique name based on title storage type
						nca_id_path += '/'+['None', 'Host', 'Gamecard', 'System', 'User', 'Sdcard'][titleStorage];
						createDirectory(sd_hnd, nca_id_path);
						nca_id_path += '/'+titleId;
						createDirectory(sd_hnd, nca_id_path);
						nca_id_path += '/'+nca_id_str;
						dumpNCA(nca_id, ncm_hnd, sd_hnd, nca_id_path, false);
					});
				});
			}); 
		}
	});
	*/
	utils.log("reached end of dumpTitle()");
};

if (true) {
	var TITLE_ID = '01007EF00011E000';
	var TITLE_TYPE = TYPE_PROGRAM;
	var TITLE_STORAGE = STORAGE_GAMECARD;
	dumpTitle(TITLE_ID, TITLE_TYPE, TITLE_STORAGE);
}
