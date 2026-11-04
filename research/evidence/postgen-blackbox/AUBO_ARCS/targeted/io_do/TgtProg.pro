<?xml version="1.0" encoding="UTF-8"?>
<AuboProgram name="TgtProg" installation="TgtProg_ins" installationRelativePath="TgtProg_ins.ins" directory="/root/arcs_ws/program" createdIn="0.29.3-rc.10" lastSaveIn="0.29.3-rc.10" robotSerialNumber="RoboDK" crcValue="225635">
    <kinematics status="NOT_INITIALIZED" validChecksum="false">
        <theta value="3.14159265358979,-1.5707963267949,0,-1.5707963267949,0,0"/>
        <a value="0.0010004,0,0.647,0.601445091,0.000451803,-0.000785351"/>
        <d value="0.1632,0.201467966,-0.000167966,0.000167966,0.10373501,0.094884533"/>
        <alpha value="0,-1.5703531067949,3.13960138358979,3.13793245358979,-1.5694211267949,1.5774796767949"/>
        <jointChecksum value="0,0,0,0,0,0"/>
    </kinematics>
    <WaypointModel>
    </WaypointModel>
    <TimerModel/>
    <VariableModel>
    </VariableModel>
    <SubProgModel/>
    <InitVariablesNode title="初始变量" id="5a921187-19c7-4df4-8f4f-f31e78de5857">
        <datamodel/>
    </InitVariablesNode>
    <MainProgramNode title="机器人编程" id="a3f2c9bf-9c63-46b9-90f2-44556f25e2a2">
        <datamodel>
            <Bool key="addBeforeStartSequence" value="false"/>
            <Bool key="loopForever" value="true"/>
        </datamodel>
        <children>
            <ScriptNode title="Func_lib.lua" id="bc8a3b76-d231-4536-b144-2c91074bfc45">
                <datamodel>
                    <Expression key="expression"/>
                    <String key="file_path" value="Func_lib.lua"/>
                    <Bool key="use_file" value="true"/>
                </datamodel>
            </ScriptNode>
        <SetNode title="Set DO00=High" id="f7c1bd87-4da5-4709-9471-3d60c8a70639">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="true"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Io key="io" name="DO00"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="false"/>
                <Bool key="syncProgramPointer" value="false"/>
                <String key="type" value="DIGITAL_OUTPUT"/>
            </datamodel>
        </SetNode>
        <SetNode title="Set DO01=High" id="e443df78-9558-467f-9ba9-1faf7a024204">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="true"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Io key="io" name="DO01"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="false"/>
                <Bool key="syncProgramPointer" value="false"/>
                <String key="type" value="DIGITAL_OUTPUT"/>
            </datamodel>
        </SetNode>
        <SetNode title="Set DO02=ON" id="23a7711a-8133-4876-b7eb-dcd9e87a1613">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="ON"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Io key="io" name="DO02"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="false"/>
                <Bool key="syncProgramPointer" value="false"/>
                <String key="type" value="DIGITAL_OUTPUT"/>
            </datamodel>
        </SetNode>
        <SetNode title="Set DO09=High" id="1846d424-c17c-4279-a3c6-612f48268673">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="true"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Io key="io" name="DO09"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="false"/>
                <Bool key="syncProgramPointer" value="false"/>
                <String key="type" value="DIGITAL_OUTPUT"/>
            </datamodel>
        </SetNode>
        <SetNode title="Set DO10=High" id="fcbd04c3-4021-4ef7-8ca5-a5a19e4d6e3c">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="true"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Io key="io" name="DO10"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="false"/>
                <Bool key="syncProgramPointer" value="false"/>
                <String key="type" value="DIGITAL_OUTPUT"/>
            </datamodel>
        </SetNode>
        <SetNode title="Set DO12=Low" id="b4862b21-fb97-4435-8856-1712e8e5216a">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="false"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Io key="io" name="DO12"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="false"/>
                <Bool key="syncProgramPointer" value="false"/>
                <String key="type" value="DIGITAL_OUTPUT"/>
            </datamodel>
        </SetNode>
        <SetNode title="Set DO99=1" id="259f4329-e6f4-490b-9a16-4106cf6a659e">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="1"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Io key="io" name="DO99"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="false"/>
                <Bool key="syncProgramPointer" value="false"/>
                <String key="type" value="DIGITAL_OUTPUT"/>
            </datamodel>
        </SetNode>
        <SetNode title="Set DOName=High" id="12e0c8b2-bad6-40fb-9948-8dec4f65d4d9">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="true"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Io key="io" name="DOName"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="false"/>
                <Bool key="syncProgramPointer" value="false"/>
                <String key="type" value="DIGITAL_OUTPUT"/>
            </datamodel>
        </SetNode>
        <SetNode title="Set DO5=High" id="5487ce1e-af19-422a-99b8-a714e61a441c">
            <datamodel>
                <Float64 key="aoValue" value="4"/>
                <Bool key="boolValue" value="true"/>
                <Int32 key="collisionLevel" value="-1"/>
                <Expression key="expression"/>
                <Io key="io" name="DO5"/>
                <Float64 key="pulseTime" value="0.5"/>
                <Bool key="setTcp" value="false"/>
                <Bool key="syncProgramPointer" value="false"/>
                <String key="type" value="DIGITAL_OUTPUT"/>
            </datamodel>
        </SetNode>
        </children>
    </MainProgramNode>

</AuboProgram>