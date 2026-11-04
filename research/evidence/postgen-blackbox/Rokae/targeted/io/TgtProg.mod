MODULE MainModule

GLOBAL Proc main()
    SetDO D_OUT_1, 1;
    SetDO D_OUT_1, 1;
    SetDO D_OUT_1, 0;
    SetDO D_OUT_1, 1;
    SetDO D_OUT_1, x;
    SetDO D_OUT_1, 1;
    SetDO D_OUT_2, 1;
    SetDO D_OUT_2, 1;
    SetDO D_OUT_2, 0;
    SetDO D_OUT_2, x;
    WaitDI D_IN_1, 1;
    WaitDI D_IN_1, 1;
    WaitDI D_IN_1, 0;
    WaitDI D_IN_1, x;
    WaitDI D_IN_1, 1, \MaxTime:=0.0;
    WaitDI D_IN_1, 1, \MaxTime:=1.2;
    WaitDI V, 1, \MaxTime:=0.1;
EndProc
EndModule
