MODULE MainModule
GLOBAL VAR robtarget robpoint0= p:{{-640.584, 506.980, 371.534},{0.374108, 0.285846, 0.853660, -0.222712}}{cfg 0,0,0,0}{EJ 0.000000000,0.000000000,0.000000000,0.000000000,0.000000000,0.000000000}


GLOBAL Proc main()
    wobj16.x = 1234.57
    wobj16.y = -98.765
    wobj16.z = 50.500
    wobj16.q1 = 0.965926
    wobj16.q2 = 0.000000
    wobj16.q3 = 0.000000
    wobj16.q4 = 0.258819
    MoveJ robpoint0,v50,z50,tool03,wobj16
    SubProg2;
    NotAProgram;
EndProc
EndModule
GLOBAL Proc main()
EndProc
EndModule
