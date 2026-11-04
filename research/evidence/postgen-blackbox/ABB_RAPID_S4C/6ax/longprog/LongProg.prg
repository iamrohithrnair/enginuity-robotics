%%%
  VERSION:1
  LANGUAGE:ENGLISH
%%%
MODULE MOD_LongProg

    ! -------------------------------
    ! Define customized variables here
    ! ...

	! Tool variables: 
	PERS tooldata ToolS := [TRUE,[[10.000,20.000,150.000],[1.00000000,0.00000000,0.00000000,0.00000000]],[1,[0,0,20],[1,0,0,0],0,0,0.005]];

	! Reference variables:
	PERS wobjdata FrameS := [FALSE, TRUE, "", [[1234.570,-98.765,50.500],[0.96592583,0.00000000,0.00000000,0.25881905]],[[0,0,0],[1,0,0,0]]];


	LOCAL PERS string modulepath1 := "";
	LOCAL PERS string modulepath2 := "";
	LOCAL VAR loadsession load1;
	LOCAL VAR loadsession load2;
	LOCAL VAR string module_unload := "";
	
	PROC Main()
		! This program has automatically been split into smaller subprograms
		TPErase;

		TPWrite "Starting Subprogram 1/4";
		! Load the first program (may take some time)
		modulepath1 := "/hd0a/Enter-Serial-Number/HOME/RoboDK/LongProg_0.prg";
		Load \Dynamic, modulepath1;
		modulepath2 := "/hd0a/Enter-Serial-Number/HOME/RoboDK/LongProg_1.prg";
		StartLoad modulepath2, load2;
		%"MOD_Tmp1:Prg_Tmp1"%;
		Unload modulepath1;
		modulepath1 := "";


		TPWrite "Starting Subprogram 2/4";
		! Wait for the program to be ready (fast)
		WaitLoad load2;
		modulepath1 := "/hd0a/Enter-Serial-Number/HOME/RoboDK/LongProg_2.prg";
		StartLoad modulepath1, load1;
		%"MOD_Tmp2:Prg_Tmp2"%;
		Unload modulepath2;
		modulepath2 := "";


		TPWrite "Starting Subprogram 3/4";
		! Wait for the program to be ready (fast)
		WaitLoad load1;
		modulepath2 := "/hd0a/Enter-Serial-Number/HOME/RoboDK/LongProg_3.prg";
		StartLoad modulepath2, load2;
		%"MOD_Tmp3:Prg_Tmp3"%;
		Unload modulepath1;
		modulepath1 := "";


		TPWrite "Starting Subprogram 4/4";
		! Wait for the program to be ready (fast)
		WaitLoad load2;
		%"MOD_Tmp1:Prg_Tmp1"%;
		Unload modulepath2;
		modulepath2 := "";


		TPWrite "Program completed";

	ENDPROC

ENDMODULE
