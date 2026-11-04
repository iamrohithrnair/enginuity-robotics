MODULE MainModule
GLOBAL VAR robtarget robpoint0= p:{{-353.026, -90.135, 331.702},{0.344329, 0.048056, 0.933073, -0.092215}}{cfg -1,0,-1,0}{EJ 0.000000000,0.000000000,0.000000000,0.000000000,0.000000000,0.000000000}
GLOBAL VAR robtarget robpoint1= p:{{-624.230, 571.208, 454.620},{0.552392, -0.042676, 0.673042, -0.489956}}{cfg -1,0,-1,1}{EJ 0.000000000,0.000000000,0.000000000,0.000000000,0.000000000,0.000000000}

GLOBAL Proc main()
    wobj16.x = 100.5
    wobj16.y = -200.250
    wobj16.z = 300.125
    wobj16.q1 = 0.943714
    wobj16.q2 = 0.268536
    wobj16.q3 = -0.144878
    wobj16.q4 = 0.127679
    tool03.x = -1.500
    tool03.y = 2.250
    tool03.z = 99.875
    tool03.q1 = 0.270598
    tool03.q2 = -0.653281
    tool03.q3 = 0.653281
    tool03.q4 = 0.270598
    MoveJ robpoint0,v123,fine,tool03,wobj16
    MoveL robpoint1,v123,z12,tool03,wobj16
    Wait 1.234
    TPWrite "A long message with "quotes", 'apostrophes' & symbols: <>[]{}()=+-*/%;#@! and more text to make it longer than eighty characters";
    SetDO Gripper, ON;
    SetDO D_OUT_12, 0;
    SetDO Pressure, 1;
    WaitDI PartPresent, 1, \MaxTime:=0.2;
    WaitDI D_IN_7, 1;
    DoSomething(12);
    x = 1
EndProc
EndModule
