# Embedded into U-Boot's default bootcmd. No mutable slot script controls slot
# selection. Environment offsets are reserved by build-ab-image.sh.
echo HIVE_AB_V1;
# The first SD probe can time out on this board. Reload the persistent boot
# state after warming the controller, before inspecting any slot variables.
mmc dev 0; mmc dev 1; mmc rescan; env load;
fdt addr ${fdtcontroladdr};
fdt get value hive_bootpath /chosen u-boot,spl-boot-device;
fdt get value hive_sdpath /aliases mmc1;
fdt get value hive_emmcpath /aliases mmc0;
if test "${hive_bootpath}" = "${hive_sdpath}"; then setenv hive_mmc 1; else
    if test "${hive_bootpath}" = "${hive_emmcpath}"; then setenv hive_mmc 0; else
        echo Unsupported boot medium; reset;
    fi;
fi;
mmc dev ${hive_mmc}; mmc rescan; mmc rescan;
if test "${hive_active}" != A && test "${hive_active}" != B; then
    setenv hive_active A; setenv hive_pending; setenv hive_tries 0;
    # A read-only environment must not turn into a reset loop: boot the factory
    # slot and leave the A/B bookkeeping degraded for the OS to report.
    if saveenv; then echo Initialized Hive slots; else echo WARNING: environment not writable; fi;
fi;
setenv hive_boot_slot 'if test "${hive_slot}" = A; then setenv hive_part 1; else setenv hive_part 2; fi; if part uuid mmc ${hive_mmc}:${hive_part} hive_rootuuid && load mmc ${hive_mmc}:${hive_part} ${kernel_addr_r} /boot/Image && load mmc ${hive_mmc}:${hive_part} ${ramdisk_addr_r} /boot/uInitrd && load mmc ${hive_mmc}:${hive_part} ${fdt_addr_r} /boot/dtb/rockchip/rk3528-nanopi-zero2.dtb; then setenv bootargs console=ttyS0,1500000 root=PARTUUID=${hive_rootuuid} rootfstype=ext4 rootwait=60 rw panic=10 oops=panic softlockup_panic=1 hive.slot=${hive_slot}; booti ${kernel_addr_r} ${ramdisk_addr_r} ${fdt_addr_r}; fi';
if test "${hive_pending}" = A || test "${hive_pending}" = B; then
    if test "${hive_tries}" -gt 0; then
        setenv hive_slot ${hive_pending}; setexpr hive_tries ${hive_tries} - 1;
        if saveenv; then run hive_boot_slot; fi;
    fi;
    setenv hive_pending; setenv hive_tries 0;
    if saveenv; then echo Falling back to confirmed slot; else echo WARNING: environment not writable; fi;
fi;
setenv hive_slot ${hive_active}; run hive_boot_slot;
# The confirmed slot can still lose its kernel files (corrupt or partial
# write). Try the other slot once before resetting; slot variables stay
# untouched so the next boot repeats the same, non-wedging decision.
echo Confirmed slot could not boot; trying the other slot;
if test "${hive_active}" = A; then setenv hive_slot B; else setenv hive_slot A; fi;
run hive_boot_slot;
echo No slot could boot; scanning for bootable media;
bootflow scan -lb;
reset;
